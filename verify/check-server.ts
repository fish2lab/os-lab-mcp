// verify/check-server.ts —— `npm run check server`：不经模型、不经 tee，直接用 stdin 给学生的
// fs-server.ts 灌 JSON-RPC，验收 docs/CONTRACT.md §8.2 里列的每一条。
// 输出格式与 check-run.ts 一致：每条 PASS/FAIL 加证据文件与行号。
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { loadParams, repoRoot } from "./params.ts";

const results: { ok: boolean; name: string; file: string; line: number }[] = [];
function assert(ok: boolean, name: string, file = "-", line = 0): boolean {
  results.push({ ok, name, file, line });
  console.log(`${ok ? "PASS" : "FAIL"} ${name} (${file}:${line})`);
  return ok;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Session {
  child: ChildProcess;
  send: (obj: unknown) => void;
  call: (method: string, params: unknown, timeoutMs?: number) => Promise<any>;
  exited: () => number | null;
  waitExit: (ms: number) => Promise<number | null>;
}

function start(logPath: string, extraArgs: string[]): Session {
  const child = spawn(process.execPath, [
    "--experimental-strip-types", join(repoRoot(), "server", "fs-server.ts"),
    "--transport", "stdio", "--log", logPath, ...extraArgs,
  ], { stdio: ["pipe", "pipe", "inherit"] });
  let exitCode: number | null | undefined;
  const exitWaiters: ((c: number | null) => void)[] = [];
  child.on("exit", (code, sig) => {
    exitCode = code ?? (sig ? 128 : null);
    exitWaiters.splice(0).forEach((f) => f(exitCode!));
  });
  const pending = new Map<number, (v: any) => void>();
  createInterface({ input: child.stdout! }).on("line", (l) => {
    try {
      const j = JSON.parse(l);
      if (typeof j.id === "number" && pending.has(j.id)) { pending.get(j.id)!(j); pending.delete(j.id); }
    } catch { /* 非 JSON 行忽略 */ }
  });
  let nextId = 1;
  const send = (obj: unknown) => { child.stdin!.write(JSON.stringify(obj) + "\n"); };
  const call = (method: string, params: unknown, timeoutMs = 5000) => new Promise<any>((resolve) => {
    const id = nextId++;
    const t = setTimeout(() => { pending.delete(id); resolve({ id, timeout: true }); }, timeoutMs);
    pending.set(id, (v) => { clearTimeout(t); resolve(v); });
    send({ jsonrpc: "2.0", id, method, params });
  });
  return {
    child, send, call,
    exited: () => (exitCode === undefined ? null : exitCode),
    waitExit: (ms) => new Promise((resolve) => {
      if (exitCode !== undefined) return resolve(exitCode);
      const t = setTimeout(() => resolve(null), ms);
      exitWaiters.push((c) => { clearTimeout(t); resolve(c); });
    }),
  };
}

const textOf = (r: any): string => (r?.result?.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");

function logLines(p: string): string[] {
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8").split(/\r?\n/).filter(Boolean);
}
function findLine(ls: string[], re: RegExp): number { const i = ls.findIndex((l) => re.test(l)); return i < 0 ? 0 : i + 1; }

async function main(): Promise<void> {
  const p = loadParams();
  const outDir = join(repoRoot(), "runs", "check-server");
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const log1 = join(outDir, "server.log");
  const log2 = join(outDir, "server.noexit.log");
  const rel1 = "runs/check-server/server.log";
  const rel2 = "runs/check-server/server.noexit.log";

  // ---- 第一轮：默认行为 ----
  const s = start(log1, []);
  const init = await s.call("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "check-server", version: "0" } });
  assert(!init.timeout && !!init.result, "initialize 有响应");
  s.send({ jsonrpc: "2.0", method: "notifications/initialized" });

  const list = await s.call("tools/list", {});
  const names = new Set<string>((list.result?.tools ?? []).map((t: any) => t.name));
  assert(["read_file", "list_dir", "run_command"].every((n) => names.has(n)), `tools/list 含 read_file、list_dir、run_command（实际 ${[...names].join(",") || "无"}）`);

  const expect = existsSync(p.target) ? readFileSync(p.target, "utf8") : "";
  const r1 = await s.call("tools/call", { name: "read_file", arguments: { path: p.target } });
  assert(!r1.error && !r1.result?.isError && textOf(r1) === expect && expect.length > 0, "read_file(target) 返回文件原文");

  const r2 = await s.call("tools/call", { name: "read_file", arguments: { path: "/etc/hosts" } });
  const msg2: string = r2.error?.message ?? "";
  assert(!!r2.error && msg2.startsWith("不允许读取"), `read_file(/etc/hosts) 返回 JSON-RPC error 且 message 以「不允许读取」开头（实际 ${JSON.stringify(r2.error ?? r2.result ?? null).slice(0, 80)}）`);

  const r3 = await s.call("tools/call", { name: "list_dir", arguments: { path: p.root + "/" } });
  assert(!r3.error && textOf(r3).includes(`${p.salt}.txt`), `list_dir(root/) 含 ${p.salt}.txt`);

  const r4 = await s.call("tools/call", { name: "run_command", arguments: { cmd: "echo hi", mode: "shell" } });
  assert(!r4.error && textOf(r4).trim() === "hi", "run_command(shell, echo hi) 返回 hi");
  const r5 = await s.call("tools/call", { name: "run_command", arguments: { cmd: "echo hi", mode: "direct" } });
  assert(!r5.error && textOf(r5).trim() === "hi", "run_command(direct, echo hi) 返回 hi");

  s.child.stdin!.end();
  const code = await s.waitExit(2000);
  assert(code === 0, `关 stdin 后 2 秒内以 0 退出（实际 ${code === null ? "未退出" : code}）`, rel1, findLine(logLines(log1), /event=exit/));
  if (code === null) s.child.kill("SIGKILL");
  await sleep(100);

  const ls = logLines(log1);
  const need: [string, RegExp][] = [
    ["start 且含 ppid", /event=start .*ppid=\d+/],
    ["tools/call", /event=tools\/call /],
    ["deny", /event=deny /],
    ["ok", /event=ok /],
    ["run_command", /event=run_command mode=/],
    ["stdin-end", /event=stdin-end/],
    ["exit", /event=exit/],
  ];
  for (const [label, re] of need) {
    const n = findLine(ls, re);
    assert(n > 0, `server.log 有 ${label} 行`, rel1, n);
  }
  const first = ls[0] ?? "";
  assert(/event=start/.test(first), "server.log 第一行是 start", rel1, 1);

  // ---- 第二轮：--no-exit-on-eof ----
  const s2 = start(log2, ["--no-exit-on-eof"]);
  const init2 = await s2.call("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "check-server", version: "0" } });
  assert(!init2.timeout, "--no-exit-on-eof 下 initialize 有响应");
  s2.send({ jsonrpc: "2.0", method: "notifications/initialized" });
  s2.child.stdin!.end();
  const code2 = await s2.waitExit(2000);
  const ls2 = logLines(log2);
  assert(code2 === null, `--no-exit-on-eof：关 stdin 2 秒后仍存活（实际 ${code2 === null ? "存活" : `退出码 ${code2}`}）`, rel2, findLine(ls2, /event=stdin-end/));
  assert(findLine(ls2, /event=stdin-end/) > 0, "--no-exit-on-eof：日志仍有 stdin-end", rel2, findLine(ls2, /event=stdin-end/));
  s2.child.kill("SIGTERM");
  await s2.waitExit(1000);

  const fails = results.filter((r) => !r.ok).length;
  console.log(`\n${fails === 0 ? "PASS" : "FAIL"} server：${results.length - fails}/${results.length} 条通过；日志在 runs/check-server/`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(2); });
