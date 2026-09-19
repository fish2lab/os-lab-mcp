// 观测原始日志的过滤模块。
//
// 在实验里的角色：eslogger（macOS）和 strace（Linux）记录的是整机或整棵进程树的事件，
// 里面夹着终端、sudo、tee 等无关进程，exec 事件还带着完整环境变量（含 API 密钥）。
// 这个模块只做两件事：按 pid 树只保留 driver / tee / server 及其后代的事件；
// 把环境变量整段删掉再落盘。逻辑独立成模块，便于用 fixtures 里的样例做单元测试。

type JsonObject = Record<string, unknown>;

/** 从任意嵌套对象里取路径，取不到返回 undefined。 */
function dig(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as JsonObject)[key];
  }
  return cur;
}

function asPid(v: unknown): number | undefined {
  return typeof v === "number" && Number.isInteger(v) && v > 0 ? v : undefined;
}

/** 递归删除所有键名为 env 的字段（数组元素也递归）。原地修改并返回同一对象。 */
export function stripEnv(value: unknown): unknown {
  if (Array.isArray(value)) {
    for (const item of value) stripEnv(item);
    return value;
  }
  if (value !== null && typeof value === "object") {
    const obj = value as JsonObject;
    for (const key of Object.keys(obj)) {
      if (key === "env") {
        delete obj[key];
      } else {
        stripEnv(obj[key]);
      }
    }
  }
  return value;
}

/** 从 parent→children 的邻接表出发，收集根 pid 及其全部后代。 */
function collectDescendants(roots: number[], children: Map<number, number[]>): Set<number> {
  const keep = new Set<number>();
  const stack = [...roots];
  while (stack.length > 0) {
    const pid = stack.pop() as number;
    if (keep.has(pid)) continue;
    keep.add(pid);
    for (const child of children.get(pid) ?? []) stack.push(child);
  }
  return keep;
}

/**
 * 过滤 eslogger 输出（`eslogger fork exec open exit`，每行一个 JSON 对象）。
 * 事件的发出进程取 `process.audit_token.pid`；fork 事件的子进程取 `event.fork.child.audit_token.pid`；
 * 先扫一遍建 pid 树，再保留根 pid 及后代的事件；每条事件深度递归删掉键名为 env 的字段。
 * 返回值仍是每行一个 JSON 字符串；解析失败的行直接丢弃。
 */
export function filterEslogger(lines: string[], rootPids: number[]): string[] {
  const parsed: JsonObject[] = [];
  for (const line of lines) {
    const text = line.trim();
    if (!text) continue;
    try {
      const obj = JSON.parse(text) as unknown;
      if (obj !== null && typeof obj === "object" && !Array.isArray(obj)) parsed.push(obj as JsonObject);
    } catch {
      // eslogger 被 pkill 时最后一行可能截断，跳过即可
    }
  }

  const children = new Map<number, number[]>();
  for (const ev of parsed) {
    const child = asPid(dig(ev, ["event", "fork", "child", "audit_token", "pid"]));
    const parent = asPid(dig(ev, ["process", "audit_token", "pid"]));
    if (child === undefined || parent === undefined) continue;
    const list = children.get(parent) ?? [];
    list.push(child);
    children.set(parent, list);
  }

  const keep = collectDescendants(rootPids, children);
  const out: string[] = [];
  for (const ev of parsed) {
    const pid = asPid(dig(ev, ["process", "audit_token", "pid"]));
    if (pid === undefined || !keep.has(pid)) continue;
    stripEnv(ev);
    out.push(JSON.stringify(ev));
  }
  return out;
}

/** strace 一行的头部：`<pid> <时间戳> <正文>`。 */
interface StraceLine {
  pid: number;
  body: string;
  raw: string;
}

function parseStraceLine(raw: string): StraceLine | undefined {
  const m = /^(\d+)\s+(?:\d+\.\d+\s+)?(.*)$/.exec(raw);
  if (!m) return undefined;
  return { pid: Number(m[1]), body: m[2], raw };
}

/** 从正文取系统调用名，兼容 `<... clone resumed>` 这种续行。 */
function syscallName(body: string): string | undefined {
  const resumed = /^<\.\.\. (\w+) resumed>/.exec(body);
  if (resumed) return resumed[1];
  const direct = /^(\w+)\(/.exec(body);
  return direct ? direct[1] : undefined;
}

/** 取行尾 `= N` 的返回值。 */
function returnValue(body: string): number | undefined {
  const m = /\)\s*=\s*(-?\d+)\s*(?:[A-Z]+ \(.*\))?\s*$/.exec(body);
  return m ? Number(m[1]) : undefined;
}

/** 把 execve 行的第三个参数（环境变量数组，-v 时会展开）替换为占位文本。 */
export function stripExecveEnv(body: string): string {
  const start = body.indexOf("execve(");
  if (start < 0) return body;
  let i = start + "execve(".length;
  let depth = 0;
  let inString = false;
  let argIndex = 0;
  let thirdStart = -1;
  for (; i < body.length; i++) {
    const ch = body[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "[" || ch === "{") { depth++; continue; }
    if (ch === "]" || ch === "}") { depth--; continue; }
    if (depth === 0 && ch === ",") {
      argIndex++;
      if (argIndex === 2) thirdStart = i + 1;
      else if (argIndex === 3) break;
      continue;
    }
    if (depth === 0 && ch === ")") break;
  }
  if (thirdStart < 0) return body;
  const third = body.slice(thirdStart, i).trim();
  if (!third.startsWith("[")) return body;
  return body.slice(0, thirdStart) + " [/* 环境变量已删 */]" + body.slice(i);
}

const FORK_LIKE = new Set(["clone", "clone3", "fork", "vfork"]);

/**
 * 过滤 strace -f 输出。返回三组文本行：
 * events：保留 strace 原格式的普通事件；ipc：socketpair 行；net：connect 行。
 * clone 带 CLONE_THREAD 的行丢弃（线程创建在这个实验里没有意义），但线程 tid 仍计入进程树，
 * 免得线程池里发出的 openat 被误当成外人。execve 行里展开的环境变量会被替换成占位。
 */
export function filterStrace(
  lines: string[],
  rootPids: number[],
): { events: string[]; ipc: string[]; net: string[] } {
  const parsed: StraceLine[] = [];
  for (const raw of lines) {
    if (!raw.trim()) continue;
    const p = parseStraceLine(raw);
    if (p) parsed.push(p);
  }

  // 第一遍：建进程树，同时记下要丢的线程创建行（含续行）。
  const children = new Map<number, number[]>();
  const dropIndex = new Set<number>();
  const pendingClone = new Map<number, { index: number; text: string }>();
  parsed.forEach((line, index) => {
    const name = syscallName(line.body);
    if (name === undefined || !FORK_LIKE.has(name)) return;
    const unfinished = line.body.includes("<unfinished ...>");
    const resumed = line.body.startsWith("<...");
    let text = line.body;
    if (unfinished) {
      pendingClone.set(line.pid, { index, text });
      return;
    }
    if (resumed) {
      const prev = pendingClone.get(line.pid);
      if (prev) {
        text = prev.text + text;
        if (text.includes("CLONE_THREAD")) dropIndex.add(prev.index);
        pendingClone.delete(line.pid);
      }
    }
    const isThread = text.includes("CLONE_THREAD");
    if (isThread) dropIndex.add(index);
    const child = returnValue(line.body);
    if (child !== undefined && child > 0) {
      const list = children.get(line.pid) ?? [];
      list.push(child);
      children.set(line.pid, list);
    }
  });

  const keep = collectDescendants(rootPids, children);
  const events: string[] = [];
  const ipc: string[] = [];
  const net: string[] = [];
  parsed.forEach((line, index) => {
    if (!keep.has(line.pid) || dropIndex.has(index)) return;
    const name = syscallName(line.body);
    let raw = line.raw;
    if (name === "execve") raw = raw.replace(line.body, stripExecveEnv(line.body));
    if (name === "socketpair") ipc.push(raw);
    else if (name === "connect") net.push(raw);
    else events.push(raw);
  });
  return { events, ipc, net };
}
