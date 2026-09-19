// 检查一次实验运行的产物是否符合指导书的「验证点」。
//
// 用法：node --experimental-strip-types verify/check-run.ts <任务名> [--dir <目录>]
//   任务名取 task0 task1 task2 task3 task4-stdio task4-http task5-naive task5-fixed task5-sandbox 之一。
//   默认读 runs/<os>/<任务名>/，--dir 可以指定别的目录（例如 verify/fixtures/task2）。
//
// 每条断言打印一行 `PASS/FAIL <断言> (<文件>:<行>)`，行号指向作为证据的那一行；
// 断言不成立又找不到证据时行号为 0。最后打印统计，出现 FAIL 时退出码为 1。
//
// 目录里的 meta.json 决定 events.log 的格式：macos 是 eslogger 的 JSONL，linux 是 strace 文本行。
// 目录里若有 params.json（fixtures 用），就用它代替仓库根的 .os-lab.json，这样样例不依赖个人参数。
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { loadParams, osName, repoRoot, type Params } from "./params.ts";

// ---------- 命令行 ----------

const TASKS = [
  "task0", "task1", "task2", "task3", "task4-stdio", "task4-http",
  "task5-naive", "task5-fixed", "task5-sandbox",
] as const;
type Task = (typeof TASKS)[number];

function parseArgs(argv: string[]): { task: Task; dir: string } {
  let task: string | undefined;
  let dir: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dir") { dir = argv[++i]; continue; }
    if (!task) task = argv[i];
  }
  if (!task || !(TASKS as readonly string[]).includes(task)) {
    console.error(`用法：verify/check-run.ts <任务名> [--dir <目录>]\n任务名：${TASKS.join(" ")}`);
    process.exit(2);
  }
  const d = dir ? resolve(dir) : join(repoRoot(), "runs", osName(), task);
  return { task: task as Task, dir: d };
}

// ---------- 结果收集 ----------

interface Evidence { file: string; line: number }

class Checker {
  readonly results: { ok: boolean; name: string; ev: Evidence }[] = [];
  readonly dir: string;
  constructor(dir: string) { this.dir = dir; }

  /** 记录一条断言。ev 为空表示没有证据行。 */
  assert(ok: boolean, name: string, ev?: Evidence | null): boolean {
    const e = ev ?? { file: "-", line: 0 };
    this.results.push({ ok, name, ev: e });
    console.log(`${ok ? "PASS" : "FAIL"} ${name} (${e.file}:${e.line})`);
    return ok;
  }

  path(name: string): string { return join(this.dir, name); }

  /** 读文本文件的全部行；文件不存在返回 null。 */
  lines(name: string): string[] | null {
    const p = this.path(name);
    if (!existsSync(p)) return null;
    const text = readFileSync(p, "utf8");
    const arr = text.split(/\r?\n/);
    if (arr.length && arr[arr.length - 1] === "") arr.pop();
    return arr;
  }

  /** 读 JSONL，每条带行号；解析失败的行跳过。 */
  jsonl(name: string): { obj: any; line: number }[] | null {
    const ls = this.lines(name);
    if (!ls) return null;
    const out: { obj: any; line: number }[] = [];
    ls.forEach((l, i) => {
      const t = l.trim();
      if (!t) return;
      try { out.push({ obj: JSON.parse(t), line: i + 1 }); } catch { /* 跳过坏行 */ }
    });
    return out;
  }

  json(name: string): any | null {
    const p = this.path(name);
    if (!existsSync(p)) return null;
    try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
  }

  /** 断言文件存在，返回是否存在。 */
  exists(name: string): boolean {
    const ok = existsSync(this.path(name));
    return this.assert(ok, `${name} 存在`, { file: name, line: ok ? 1 : 0 });
  }

  summary(): number {
    const fails = this.results.filter((r) => !r.ok).length;
    console.log(`\n共 ${this.results.length} 条断言，通过 ${this.results.length - fails}，未通过 ${fails}`);
    return fails ? 1 : 0;
  }
}

// ---------- 参数 ----------

function loadParamsFor(dir: string): Params {
  const local = join(dir, "params.json");
  if (existsSync(local)) return JSON.parse(readFileSync(local, "utf8")) as Params;
  return loadParams();
}

function pickOs(c: Checker): "macos" | "linux" {
  const meta = c.json("meta.json");
  if (meta && (meta.os === "macos" || meta.os === "linux")) return meta.os;
  return osName();
}

/** 路径比较：能 realpath 就 realpath，否则只做规范化。 */
function canon(p: string): string {
  try { return realpathSync(p); } catch { return resolve(p); }
}

function samePath(a: string | undefined, b: string): boolean {
  if (!a) return false;
  return a === b || canon(a) === canon(b);
}

// ---------- 事件统一表示 ----------

interface Ev {
  kind: "fork" | "exec" | "open" | "exit" | "other";
  pid: number;          // 发出事件的进程
  ppid?: number;
  child?: number;       // fork 出的子进程
  target?: number;      // exec 后的进程（macOS 与 pid 相同）
  argv?: string[];
  path?: string;        // open 的文件
  line: number;
}

function num(x: unknown): number | undefined {
  return typeof x === "number" ? x : typeof x === "string" && /^\d+$/.test(x) ? Number(x) : undefined;
}

/** eslogger JSONL 的一条转成 Ev。 */
function parseEsEvent(obj: any, line: number): Ev | null {
  const pid = num(obj?.process?.audit_token?.pid);
  if (pid === undefined) return null;
  const ppid = num(obj?.process?.ppid);
  const ev = obj?.event ?? {};
  if (ev.fork) return { kind: "fork", pid, ppid, child: num(ev.fork.child?.audit_token?.pid), line };
  if (ev.exec) {
    const args = Array.isArray(ev.exec.args) ? ev.exec.args.map(String) : [];
    return { kind: "exec", pid, ppid, target: num(ev.exec.target?.audit_token?.pid) ?? pid, argv: args, line };
  }
  if (ev.open) return { kind: "open", pid, ppid, path: ev.open.file?.path, line };
  if (ev.exit) return { kind: "exit", pid, ppid, line };
  return { kind: "other", pid, ppid, line };
}

/** 取 strace 参数里所有双引号字符串（含 execve 的 argv）。 */
function quotedStrings(s: string): string[] {
  const out: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out.push(m[1].replace(/\\(.)/g, "$1"));
  return out;
}

/** strace -f -ttt 的一行转成 Ev。格式：`<pid> <秒.微秒> <系统调用>(<参数>) = <返回值>`。 */
function parseStraceLine(l: string, line: number): Ev | null {
  const exited = /^(\d+)\s+[\d.]+\s+\+\+\+ exited/.exec(l);
  if (exited) return { kind: "exit", pid: Number(exited[1]), line };
  const m = /^(\d+)\s+[\d.]+\s+(\w+)\((.*)\)\s*=\s*(-?\w+)/.exec(l);
  if (!m) return null;
  const pid = Number(m[1]);
  const call = m[2];
  const args = m[3];
  const ret = m[4];
  if (call === "execve" || call === "execveat") {
    const strs = quotedStrings(args);
    // execve("/bin/x", ["x", "-a"], ...)：第一个字符串是可执行文件，之后到 envp 前的字符串是 argv
    const argvPart = /\[(.*?)\]/.exec(args);
    const argv = argvPart ? quotedStrings(argvPart[1]) : strs.slice(1);
    return { kind: "exec", pid, target: pid, argv: argv.length ? argv : strs.slice(0, 1), line };
  }
  if (call === "openat" || call === "open" || call === "openat2") {
    const strs = quotedStrings(args);
    return { kind: "open", pid, path: strs[0], line };
  }
  if (call === "clone" || call === "clone3" || call === "fork" || call === "vfork") {
    return { kind: "fork", pid, child: num(ret), line };
  }
  if (call === "exit_group" || call === "exit") return { kind: "exit", pid, line };
  return { kind: "other", pid, line };
}

function loadEvents(c: Checker, os: "macos" | "linux", name = "events.log"): Ev[] | null {
  if (os === "macos") {
    const rows = c.jsonl(name);
    if (!rows) return null;
    return rows.map((r) => parseEsEvent(r.obj, r.line)).filter((e): e is Ev => !!e);
  }
  const ls = c.lines(name);
  if (!ls) return null;
  return ls.map((l, i) => parseStraceLine(l, i + 1)).filter((e): e is Ev => !!e);
}

/** 进程自身启动时的 exec（target 就是 driver）不计入「driver 之外的 exec」。 */
function execsExceptSelf(evs: Ev[], selfPid: number | undefined): Ev[] {
  return evs.filter((e) => e.kind === "exec" && e.target !== selfPid);
}

function findOpen(evs: Ev[], path: string, pid?: number): Ev | undefined {
  return evs.find((e) => e.kind === "open" && samePath(e.path, path) && (pid === undefined || e.pid === pid));
}

// ---------- 其它产物 ----------

interface Pids { driver?: number; tee?: number | null; server?: number | null }

function loadPids(c: Checker): Pids {
  const p = c.json("pids.json");
  const ok = c.assert(!!p && typeof p.driver === "number", "pids.json 存在且含 driver pid", { file: "pids.json", line: p ? 1 : 0 });
  return ok ? (p as Pids) : {};
}

/** ps -o pid,ppid,command 的输出：第一行是表头。 */
function parsePs(ls: string[]): { pid: number; ppid: number; command: string; line: number }[] {
  const out: { pid: number; ppid: number; command: string; line: number }[] = [];
  ls.forEach((l, i) => {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(l);
    if (m) out.push({ pid: Number(m[1]), ppid: Number(m[2]), command: m[3], line: i + 1 });
  });
  return out;
}

interface Wire { dir: "c2s" | "s2c"; json: any; line: number; raw: string }

function loadWire(c: Checker, name = "wire.log"): Wire[] | null {
  const rows = c.jsonl(name);
  if (!rows) return null;
  const ls = c.lines(name) ?? [];
  return rows
    .filter((r) => r.obj && (r.obj.dir === "c2s" || r.obj.dir === "s2c"))
    .map((r) => ({ dir: r.obj.dir, json: r.obj.json, line: r.line, raw: ls[r.line - 1] ?? "" }));
}

/** 报文可能是单条 JSON-RPC 对象，也可能是数组（批量）；统一展开。 */
function rpcObjects(w: Wire): any[] {
  if (Array.isArray(w.json)) return w.json;
  if (w.json && typeof w.json === "object") return [w.json];
  return [];
}

function firstServerPidFromLog(ls: string[]): { pid: number; line: number } | null {
  for (let i = 0; i < ls.length; i++) {
    const m = /\bpid=(\d+)\b/.exec(ls[i]);
    if (m) return { pid: Number(m[1]), line: i + 1 };
  }
  return null;
}

/** wire.log 里 s2c 报文中的错误信息：JSON-RPC error.message，或工具结果 isError 时的文本。 */
function s2cErrorTexts(wire: Wire[]): { text: string; line: number }[] {
  const out: { text: string; line: number }[] = [];
  for (const w of wire) {
    if (w.dir !== "s2c") continue;
    for (const o of rpcObjects(w)) {
      if (o?.error?.message) out.push({ text: String(o.error.message), line: w.line });
      else if (o?.result?.isError && Array.isArray(o.result.content)) {
        const t = o.result.content.map((x: any) => x?.text ?? "").join("\n");
        out.push({ text: t, line: w.line });
      }
    }
  }
  return out;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object).sort();
  const kb = Object.keys(b as object).sort();
  if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
  return ka.every((k) => deepEqual((a as any)[k], (b as any)[k]));
}

function findLine(ls: string[] | null, needle: string | RegExp): number {
  if (!ls) return 0;
  const i = ls.findIndex((l) => (typeof needle === "string" ? l.includes(needle) : needle.test(l)));
  return i < 0 ? 0 : i + 1;
}

// ---------- 各任务的断言 ----------

function checkTask0(c: Checker): void {
  const rows = c.jsonl("transcript.log");
  if (!c.assert(!!rows, "transcript.log 存在", { file: "transcript.log", line: rows ? 1 : 0 })) return;
  const models = rows!.filter((r) => r.obj?.kind === "model" && Array.isArray(r.obj.toolCalls) && r.obj.toolCalls.length > 0);
  c.assert(models.length === 3, `带 toolCalls 的 model 记录恰 3 条（实际 ${models.length}）`, { file: "transcript.log", line: models[0]?.line ?? 0 });
  for (const m of models) {
    c.assert(m.obj.toolCalls[0].name === "read_file", "model 记录的 toolCalls[0].name 为 read_file", { file: "transcript.log", line: m.line });
  }
  const paths = models.map((m) => String(m.obj.toolCalls[0]?.arguments?.path ?? ""));
  const canons = paths.map(canon);
  const same = paths.length > 0 && paths.every(Boolean) && canons.every((p) => p === canons[0]);
  c.assert(same, "三次工具调用的 path 指向同一个真实路径", { file: "transcript.log", line: models[0]?.line ?? 0 });
}

function checkTask1(c: Checker, os: "macos" | "linux", p: Params): void {
  const pids = loadPids(c);
  const evs = loadEvents(c, os);
  if (c.assert(!!evs, "events.log 存在", { file: "events.log", line: evs ? 1 : 0 })) {
    const open = pids.driver !== undefined ? findOpen(evs!, p.target, pids.driver) : undefined;
    c.assert(!!open, "events.log 里 driver 进程自己 open 了 target", open ? { file: "events.log", line: open.line } : { file: "events.log", line: 0 });
    const ex = execsExceptSelf(evs!, pids.driver);
    c.assert(ex.length === 0, `没有 exec 事件（driver 之外，实际 ${ex.length} 条）`, { file: "events.log", line: ex[0]?.line ?? 1 });
  }
  const net = c.lines("net.txt");
  c.assert(findLine(net, ":443") > 0, "net.txt 有到 :443 的连接", { file: "net.txt", line: findLine(net, ":443") });
}

function checkTask2(c: Checker, os: "macos" | "linux", p: Params): void {
  const pids = loadPids(c);
  const evs = loadEvents(c, os);
  if (c.assert(!!evs, "events.log 存在", { file: "events.log", line: evs ? 1 : 0 })) {
    const ex = execsExceptSelf(evs!, pids.driver);
    c.assert(ex.length === 2, `exec 事件恰 2 条（driver 之外，实际 ${ex.length} 条）`, { file: "events.log", line: ex[0]?.line ?? 0 });
    const second = ex[1];
    c.assert(!!second && (second.argv ?? []).some((a) => a.includes("fs-server")), "第二条 exec 的 argv 含 fs-server", { file: "events.log", line: second?.line ?? 0 });
    const server = pids.server ?? undefined;
    const open = server !== undefined ? findOpen(evs!, p.target, server) : undefined;
    c.assert(!!open && server !== pids.driver, "open(target) 的进程是 server 且 server ≠ driver", { file: "events.log", line: open?.line ?? 0 });
  }
  const psLines = c.lines("ps.txt");
  if (c.assert(!!psLines, "ps.txt 存在", { file: "ps.txt", line: psLines ? 1 : 0 })) {
    const rows = parsePs(psLines!);
    const server = rows.find((r) => r.pid === pids.server);
    const tee = rows.find((r) => r.pid === pids.tee);
    c.assert(!!server && server.ppid === pids.tee, "ps.txt 里 server 的父进程是 tee", { file: "ps.txt", line: server?.line ?? 0 });
    c.assert(!!tee && tee.ppid === pids.driver, "ps.txt 里 tee 的父进程是 driver", { file: "ps.txt", line: tee?.line ?? 0 });
  }
  checkWireOrder(c, loadWire(c));
  const handles = c.lines("handles.txt");
  if (c.assert(!!handles, "handles.txt 存在", { file: "handles.txt", line: handles ? 1 : 0 })) {
    const u = findLine(handles, /unix|socket:/);
    c.assert(u > 0, "handles.txt 含 unix 套接字", { file: "handles.txt", line: u });
    const pi = findLine(handles, /PIPE|pipe:/);
    c.assert(pi > 0, "handles.txt 含管道", { file: "handles.txt", line: pi });
  }
}

/** c2s 报文顺序：initialize → notifications/initialized → tools/list → tools/call。 */
function checkWireOrder(c: Checker, wire: Wire[] | null, name = "wire.log"): void {
  if (!c.assert(!!wire, `${name} 存在`, { file: name, line: wire ? 1 : 0 })) return;
  const methods: { m: string; line: number }[] = [];
  for (const w of wire!) {
    if (w.dir !== "c2s") continue;
    for (const o of rpcObjects(w)) if (typeof o?.method === "string") methods.push({ m: o.method, line: w.line });
  }
  const want = ["initialize", "notifications/initialized", "tools/list", "tools/call"];
  let idx = 0;
  let lastLine = 0;
  for (const x of methods) {
    if (idx < want.length && x.m === want[idx]) { idx++; lastLine = x.line; }
  }
  const firstIsInit = methods[0]?.m === "initialize";
  c.assert(idx === want.length && firstIsInit, `${name} 的 c2s 顺序为 initialize → notifications/initialized → tools/list → tools/call`, { file: name, line: lastLine || (methods[0]?.line ?? 0) });
}

function checkTask3(c: Checker, os: "macos" | "linux", p: Params): void {
  const pids = loadPids(c);
  const evs = loadEvents(c, os);
  if (c.assert(!!evs, "events.log 存在（driver 侧）", { file: "events.log", line: evs ? 1 : 0 })) {
    const ex = execsExceptSelf(evs!, pids.driver);
    c.assert(ex.length === 0, `driver 侧没有 exec 事件（实际 ${ex.length} 条）`, { file: "events.log", line: ex[0]?.line ?? 1 });
  }
  const net = c.lines("net.txt");
  c.assert(findLine(net, ":443") > 0, "net.txt 有到 :443 的连接", { file: "net.txt", line: findLine(net, ":443") });
  c.assert(findLine(net, `:${p.teePort}`) > 0, `net.txt 有到 :${p.teePort}（tee）的连接`, { file: "net.txt", line: findLine(net, `:${p.teePort}`) });

  // Server 侧：runs/<os>/task3/server/
  const s = new Checker(join(c.dir, "server"));
  const slog = s.lines("server.log");
  const first = slog ? firstServerPidFromLog(slog) : null;
  c.assert(!!first, "server/server.log 第一行能读出 server pid", { file: "server/server.log", line: first?.line ?? 0 });
  const sevs = loadEvents(s, os);
  if (c.assert(!!sevs, "server/events.log 存在", { file: "server/events.log", line: sevs ? 1 : 0 })) {
    const open = first ? findOpen(sevs!, p.target, first.pid) : undefined;
    c.assert(!!open, "server/events.log 里 open(target) 的进程是 server.log 记录的 pid", { file: "server/events.log", line: open?.line ?? 0 });
  }

  // 与 task2 的 tools/call 参数比较
  const wire3 = loadWire(c);
  checkWireOrder(c, wire3);
  const t2 = new Checker(join(dirname(c.dir), "task2"));
  const wire2 = loadWire(t2);
  const call3 = wire3 ? toolsCallParams(wire3) : null;
  const call2 = wire2 ? toolsCallParams(wire2) : null;
  c.assert(!!call2 && !!call3 && deepEqual(call2.params, call3.params), "task3 与 task2 的 tools/call params 深相等", { file: "wire.log", line: call3?.line ?? 0 });
}

function toolsCallParams(wire: Wire[]): { params: any; line: number } | null {
  for (const w of wire) {
    if (w.dir !== "c2s") continue;
    for (const o of rpcObjects(w)) if (o?.method === "tools/call") return { params: o.params, line: w.line };
  }
  return null;
}

function checkTask4Stdio(c: Checker, os: "macos" | "linux"): void {
  const pids = loadPids(c);
  const ak = c.lines("after-kill.txt");
  c.assert(findLine(ak, "not found") > 0, "after-kill.txt 显示 server 进程已不存在（not found）", { file: "after-kill.txt", line: findLine(ak, "not found") });
  const slog = c.lines("server.log");
  c.assert(findLine(slog, "event=stdin-end") > 0, "server.log 记录了 stdin-end", { file: "server.log", line: findLine(slog, "event=stdin-end") });
  const evs = loadEvents(c, os);
  if (c.assert(!!evs, "events.log 存在", { file: "events.log", line: evs ? 1 : 0 })) {
    const exit = evs!.find((e) => e.kind === "exit" && e.pid === pids.server);
    c.assert(!!exit, "events.log 有 server 的 exit 事件", { file: "events.log", line: exit?.line ?? 0 });
  }
}

/** task4-http：Server 与 driver 无父子关系，driver 死后 Server 还在；本任务期间 server.log 只有 tools/call，没有生命周期事件。 */
function checkTask4Http(c: Checker): void {
  const pids = loadPids(c);
  const ak = c.lines("after-kill.txt");
  const line = pids.server ? findLine(ak, new RegExp(`^\\s*${pids.server}\\b`)) : 0;
  c.assert(line > 0, `after-kill.txt 里有 server pid ${pids.server ?? "?"} 的进程行`, { file: "after-kill.txt", line });

  // server.log 优先取本目录的副本，否则取 task3/server/server.log；以 meta.started 为界判断有没有新增行
  const local = c.lines("server.log");
  const t3 = new Checker(join(dirname(c.dir), "task3", "server"));
  const slog = local ?? t3.lines("server.log");
  const logName = local ? "server.log" : "../task3/server/server.log";
  const meta = c.json("meta.json");
  const started = meta?.started ? Date.parse(meta.started) : NaN;
  if (!c.assert(!!slog && !Number.isNaN(started), "能读到 server.log 与 meta.started 用于比较", { file: slog ? logName : "meta.json", line: slog ? 1 : 0 })) return;
  // 本任务期间 Server 应服务了一次 tools/call，且从 driver 挂起到观测结束之间没有 stdin-end / exit：
  // http 下 Server 与 driver 没有连接层面的生命周期耦合，driver 死了它感知不到。
  const ended = meta?.ended ? Date.parse(meta.ended) : Date.now();
  let served = 0;
  let lifecycle = 0;
  slog!.forEach((l, i) => {
    const ts = Date.parse(l.slice(0, l.indexOf(" ")));
    if (Number.isNaN(ts) || ts < started || ts > ended) return;
    if (l.includes("event=tools/call")) served = served || i + 1;
    if (/event=(stdin-end|exit)\b/.test(l)) lifecycle = lifecycle || i + 1;
  });
  c.assert(served > 0, "server.log 里有本任务期间的 tools/call（Server 确实服务了这次请求）", { file: logName, line: served || slog!.length });
  c.assert(lifecycle === 0, "driver 退出到观测结束之间 server.log 没有 stdin-end / exit（Server 没有感知到 driver 退出）", { file: logName, line: lifecycle || slog!.length });
}

function checkTask5(c: Checker, os: "macos" | "linux", p: Params, variant: "naive" | "fixed" | "sandbox"): void {
  const pids = loadPids(c);
  const wire = loadWire(c);
  const evs = loadEvents(c, os);
  const errs = wire ? s2cErrorTexts(wire) : [];
  const openDecoy = evs && pids.server ? findOpen(evs, p.decoy, pids.server) : undefined;
  c.assert(!!wire, "wire.log 存在", { file: "wire.log", line: wire ? 1 : 0 });
  c.assert(!!evs, "events.log 存在", { file: "events.log", line: evs ? 1 : 0 });
  if (variant === "naive") {
    const flagLine = wire?.find((w) => w.dir === "s2c" && w.raw.includes("FLAG{"))?.line ?? 0;
    c.assert(flagLine > 0, "wire.log 的 s2c 报文泄露了 FLAG{", { file: "wire.log", line: flagLine });
    c.assert(!!openDecoy, "events.log 有 server 对 decoy 的 open", { file: "events.log", line: openDecoy?.line ?? 0 });
  } else if (variant === "fixed") {
    const hit = errs.find((e) => e.text.includes("不允许读取"));
    c.assert(!!hit, "wire.log 的 s2c 有错误且信息含「不允许读取」", { file: "wire.log", line: hit?.line ?? 0 });
    c.assert(!openDecoy, "events.log 没有 server 对 decoy 的 open", { file: "events.log", line: openDecoy?.line ?? 1 });
  } else if (os === "macos") {
    const hit = errs.find((e) => e.text.includes("EPERM"));
    c.assert(!!hit, "wire.log 的 s2c 错误信息含 EPERM（沙箱在 open 时拒绝）", { file: "wire.log", line: hit?.line ?? 0 });
    c.assert(!!openDecoy, "events.log 有 server 对 decoy 的 open（校验放行，内核拒绝）", { file: "events.log", line: openDecoy?.line ?? 0 });
  } else {
    const hit = errs.find((e) => e.text.includes("ENOENT"));
    c.assert(!!hit, "wire.log 的 s2c 错误信息含 ENOENT（tmpfs 遮住了 decoy 目录）", { file: "wire.log", line: hit?.line ?? 0 });
  }
}

// ---------- 入口 ----------

function main(): void {
  const { task, dir } = parseArgs(process.argv.slice(2));
  const c = new Checker(dir);
  console.log(`检查 ${task}：${dir}`);
  if (!existsSync(dir)) {
    console.error(`目录不存在：${dir}`);
    process.exit(1);
  }
  const os = pickOs(c);
  const p = loadParamsFor(dir);
  c.exists("meta.json");
  switch (task) {
    case "task0": checkTask0(c); break;
    case "task1": checkTask1(c, os, p); break;
    case "task2": checkTask2(c, os, p); break;
    case "task3": checkTask3(c, os, p); break;
    case "task4-stdio": checkTask4Stdio(c, os); break;
    case "task4-http": checkTask4Http(c); break;
    case "task5-naive": checkTask5(c, os, p, "naive"); break;
    case "task5-fixed": checkTask5(c, os, p, "fixed"); break;
    case "task5-sandbox": checkTask5(c, os, p, "sandbox"); break;
  }
  process.exit(c.summary());
}

main();
