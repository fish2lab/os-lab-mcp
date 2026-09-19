// 观测器入口：把 driver（或 HTTP 模式下的 Server）放在系统级追踪器下运行，产出实验要交的证据文件。
//
// 在实验里的角色：学生不直接跑 driver，而是跑 `npm run observe <local|stdio|http|server-http> [driver 参数]`。
// 本文件负责：决定任务名和输出目录、写 meta.json、生成沙箱配置、调用平台脚本（macOS 用 eslogger，
// Linux 用 strace）、在 driver 打印 OSLAB-EVENT 的时刻拍 ps / lsof 快照、结束后过滤原始日志得到
// events.log / ipc.txt / net.txt。原始日志（raw.*）含环境变量，不进 git。
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadParams, repoRoot, type Params } from "../verify/params.ts";
import { filterEslogger, filterStrace } from "./filter.ts";

type Mode = "local" | "stdio" | "http" | "server-http";
const MODES: Mode[] = ["local", "stdio", "http", "server-http"];
const STRIP = "--experimental-strip-types";
const here = dirname(fileURLToPath(import.meta.url));

interface Pids { driver: number; tee: number | null; server: number | null }

function usage(): never {
  console.error("用法：node observe/observe.ts <local|stdio|http|server-http> [driver 的其余参数原样透传]");
  process.exit(2);
}

/** 读透传参数里 `--key value` 的值；没有返回 undefined。 */
function argValue(args: string[], key: string): string | undefined {
  const i = args.indexOf(key);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

/** 与 driver 相同的默认规则决定任务名。 */
function decideTask(mode: Mode, args: string[]): string {
  const explicit = argValue(args, "--task");
  if (explicit) return explicit;
  if (mode === "server-http") return "task3";
  const hang = args.includes("--hang");
  if (mode === "local") return "task1";
  if (mode === "stdio") return hang ? "task4-stdio" : "task2";
  return hang ? "task4-http" : "task3";
}

function decideDir(mode: Mode, task: string, args: string[], params: Params): string {
  const explicit = argValue(args, "--out");
  if (explicit) return resolve(explicit);
  const base = join(repoRoot(), "runs", params.os, task);
  return mode === "server-http" ? join(base, "server") : base;
}

function run(cmd: string, args: string[]): { out: string; ok: boolean } {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  return { out: (r.stdout ?? "") + (r.stderr ?? ""), ok: r.status === 0 };
}

function readPids(dir: string): Pids | undefined {
  const f = join(dir, "pids.json");
  if (!existsSync(f)) return undefined;
  try { return JSON.parse(readFileSync(f, "utf8")) as Pids; } catch { return undefined; }
}

/** server.log 第一行形如 `<iso> pid=123 ppid=45 event=start ...`。 */
function serverPidFromLog(file: string): number | undefined {
  if (!existsSync(file)) return undefined;
  const first = readFileSync(file, "utf8").split("\n")[0] ?? "";
  const m = /\bpid=(\d+)/.exec(first);
  return m ? Number(m[1]) : undefined;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 用模板生成沙箱配置：把 __SECRET_DIR__ 换成诱饵文件所在目录。 */
function writeSandboxFiles(dir: string, params: Params): { sb: string; bwrap: string } {
  const secretDir = dirname(params.decoy);
  const sb = join(dir, "os-lab.sb");
  const bwrap = join(dir, "bwrap-args.txt");
  for (const [tpl, out] of [["os-lab.sb", sb], ["bwrap-args.txt", bwrap]] as const) {
    const text = readFileSync(join(here, tpl), "utf8").replaceAll("__SECRET_DIR__", secretDir);
    writeFileSync(out, text);
  }
  return { sb, bwrap };
}

async function main(): Promise<void> {
  const [modeArg, ...passthrough] = process.argv.slice(2);
  if (!modeArg || !MODES.includes(modeArg as Mode)) usage();
  const mode = modeArg as Mode;
  const params = loadParams();
  const root = repoRoot();
  const isMac = params.os === "macos";

  // 没有 sudo 就不开工：静默降级会让学生拿到一份空的 events.log 还以为观测成功。
  if (isMac) {
    const r = spawnSync("sudo", ["-n", "true"], { stdio: "ignore" });
    if (r.status !== 0) {
      console.error("需要 sudo：先运行 sudo -v 再重试");
      process.exit(3);
    }
  }

  const task = decideTask(mode, passthrough);
  const dir = decideDir(mode, task, passthrough, params);
  mkdirSync(dir, { recursive: true });

  // 组装被观测的命令行。server-http 模式只起 Server，等用户 Ctrl-C。
  let cmd: string[];
  if (mode === "server-http") {
    cmd = [process.execPath, STRIP, join(root, "server/fs-server.ts"), "--transport", "http", "--log", join(dir, "server.log")];
  } else {
    cmd = [process.execPath, STRIP, join(root, "driver/run.ts"), "--mode", mode, ...passthrough];
    if (argValue(passthrough, "--task") === undefined) cmd.push("--task", task);
    if (argValue(passthrough, "--out") === undefined) cmd.push("--out", dir);
    if (task === "task5-sandbox" && !passthrough.includes("--sandbox")) cmd.push("--sandbox");
  }

  const meta: Record<string, unknown> = {
    task, os: params.os, mode, argv: cmd.slice(1), started: new Date().toISOString(), ended: null, exitCode: null,
  };
  const metaFile = join(dir, "meta.json");
  writeFileSync(metaFile, JSON.stringify(meta, null, 2) + "\n");

  // 任务 5 第 3 步：临时换回 naive 校验，让拒绝只可能来自 OS 沙箱。
  const checkFile = join(root, "server/check.ts");
  const naiveFile = join(root, "server/check.naive.ts");
  if (task === "task5-sandbox") {
    if (!existsSync(naiveFile)) throw new Error("缺少 server/check.naive.ts，无法做沙箱对照");
    writeFileSync(checkFile, readFileSync(naiveFile));
    if (!readFileSync(checkFile).equals(readFileSync(naiveFile))) throw new Error("复制 check.naive.ts 到 check.ts 后内容不一致");
    console.error("已把 server/check.ts 临时换成 naive 版，跑完会用 git checkout 还原");
  }

  const sandbox = writeSandboxFiles(dir, params);
  const env = { ...process.env, OSLAB_OUT: dir, OSLAB_SANDBOX_FILE: isMac ? sandbox.sb : sandbox.bwrap };

  const script = join(here, isMac ? "observe-macos.sh" : "observe-linux.sh");
  console.error(`观测：task=${task} dir=${dir}`);
  const child = spawn("bash", [script, dir, mode, "--", ...cmd], { env, stdio: ["inherit", "pipe", "inherit"] });

  // Ctrl-C 交给前台的 driver / Server 处理，本进程留到收尾。
  process.on("SIGINT", () => { /* 等子进程退出后统一收尾 */ });

  const pending: Promise<void>[] = [];

  // driver 宣布即将调模型：等 1 秒让连接建立，再拍进程树、网络连接和 fd 快照。
  async function onModelCallStart(): Promise<void> {
    await sleep(1000);
    const pids = readPids(dir);
    if (!pids) { console.error("没有找到 pids.json，跳过 ps/lsof 快照"); return; }
    const all = [pids.driver, pids.tee, pids.server].filter((p): p is number => typeof p === "number");
    writeFileSync(join(dir, "ps.txt"), run("ps", ["-o", "pid,ppid,command", "-p", all.join(",")]).out);
    if (isMac) {
      writeFileSync(join(dir, "net.txt"), run("lsof", ["-nP", "-a", "-p", String(pids.driver), "-i"]).out);
      writeFileSync(join(dir, "handles.txt"), run("lsof", ["-nP", "-p", all.join(",")]).out);
    } else {
      const lines = all.map((p) => `== pid ${p} ==\n` + run("ls", ["-l", `/proc/${p}/fd`]).out);
      writeFileSync(join(dir, "handles.txt"), lines.join("\n"));
    }
  }

  // driver 宣布挂起：等它被 kill 后 5 秒，看 Server 是否还活着。
  async function onHang(driverPid: number, serverPid: number): Promise<void> {
    while (spawnSync("kill", ["-0", String(driverPid)], { stdio: "ignore" }).status === 0) await sleep(500);
    await sleep(5000);
    const r = run("ps", ["-p", String(serverPid)]);
    writeFileSync(join(dir, "after-kill.txt"), r.ok ? r.out : `pid ${serverPid} not found\n`);
  }

  let buffer = "";
  child.stdout.on("data", (chunk: Buffer) => {
    process.stdout.write(chunk);
    buffer += chunk.toString("utf8");
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl); buffer = buffer.slice(nl + 1);
      const m = /OSLAB-EVENT\s+(\S+)(.*)$/.exec(line);
      if (!m) continue;
      const [, name, rest] = m;
      if (name === "model-call-start") pending.push(onModelCallStart());
      if (name === "hang") {
        const d = /driver=(\d+)/.exec(rest); const s = /server=(\d+)/.exec(rest);
        if (d && s) pending.push(onHang(Number(d[1]), Number(s[1])));
      }
    }
  });

  const exitCode: number = await new Promise((res) => child.on("close", (code, signal) => res(code ?? (signal ? 128 : 1))));
  await Promise.all(pending);

  // 过滤原始日志。根 pid：driver 模式取 pids.json；server-http 取 server.log 第一行。
  let roots: number[] = [];
  if (mode === "server-http") {
    const p = serverPidFromLog(join(dir, "server.log"));
    if (p !== undefined) roots = [p];
  } else {
    const pids = readPids(dir);
    if (pids) roots = [pids.driver, pids.tee, pids.server].filter((p): p is number => typeof p === "number");
  }
  if (roots.length === 0) console.error("没有拿到根 pid（pids.json 或 server.log 缺失），events.log 会是空的");

  if (isMac) {
    const raw = join(dir, "raw.eslogger");
    const lines = existsSync(raw) ? readFileSync(raw, "utf8").split("\n") : [];
    const events = filterEslogger(lines, roots);
    writeFileSync(join(dir, "events.log"), events.map((l) => l + "\n").join(""));
    console.error(`events.log：${events.length} 条（原始 ${lines.length} 行，根 pid ${roots.join(",") || "无"}）`);
  } else {
    const raw = join(dir, "raw.strace");
    const lines = existsSync(raw) ? readFileSync(raw, "utf8").split("\n") : [];
    const r = filterStrace(lines, roots);
    writeFileSync(join(dir, "events.log"), r.events.map((l) => l + "\n").join(""));
    writeFileSync(join(dir, "ipc.txt"), r.ipc.map((l) => l + "\n").join(""));
    writeFileSync(join(dir, "net.txt"), r.net.map((l) => l + "\n").join(""));
    console.error(`events.log：${r.events.length} 条，ipc ${r.ipc.length} 条，net ${r.net.length} 条（原始 ${lines.length} 行）`);
  }

  if (task === "task5-sandbox") {
    if (isMac) {
      const r = run("/usr/bin/log", ["show", "--last", "3m", "--predicate", 'eventMessage CONTAINS "os-lab-secret"']);
      writeFileSync(join(dir, "sandbox.log"), r.out);
    }
    const g = spawnSync("git", ["checkout", "--", "server/check.ts"], { cwd: root, stdio: "inherit" });
    if (g.status !== 0) console.error("git checkout -- server/check.ts 失败，请手动还原");
    if (readFileSync(checkFile).equals(readFileSync(naiveFile))) {
      console.error("警告：你还没提交 realpath 版（server/check.ts 与 check.naive.ts 仍然相同）");
    }
  }

  meta.ended = new Date().toISOString();
  meta.exitCode = exitCode;
  writeFileSync(metaFile, JSON.stringify(meta, null, 2) + "\n");
  console.error(`观测结束 exit=${exitCode}，证据在 ${dir}`);
  process.exit(exitCode);
}

main().catch((e: unknown) => {
  console.error(`观测器出错：${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
