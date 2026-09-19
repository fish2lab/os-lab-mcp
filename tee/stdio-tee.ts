// stdio 传输的「录音机」。它在实验里的角色：
// driver 把它当成 Server 启动（driver 的子进程是它，它再 spawn 真正的 Server），
// 于是 driver 与 Server 之间每一行 JSON-RPC 报文都会经过它，它原样转发并写进 DIR/wire.log。
// 这样学生能看到 MCP 在 stdio 上到底传了什么，而 driver 与 Server 的代码都不需要改。
// 它不主动杀 Server：自己 stdin 关闭时只关闭 Server 的 stdin，Server 是否退出由 Server 自己决定，
// 这是任务 4 观察「父进程死了子进程怎么办」的前提。
// 用法：node tee/stdio-tee.ts --out DIR -- <cmd> <args...>
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

function parseArgs(argv: string[]): { out: string; cmd: string[] } {
  let out = "";
  let i = 0;
  for (; i < argv.length; i++) {
    if (argv[i] === "--out") out = argv[++i] ?? "";
    else if (argv[i] === "--") { i++; break; }
    else throw new Error(`stdio-tee：无法识别的参数 ${argv[i]}`);
  }
  const cmd = argv.slice(i);
  if (!out || cmd.length === 0) throw new Error("用法：node tee/stdio-tee.ts --out DIR -- <cmd> <args...>");
  return { out, cmd };
}

const { out, cmd } = parseArgs(process.argv.slice(2));
mkdirSync(out, { recursive: true });
const wireLog = join(out, "wire.log");

/** 每行报文写一条记录；能解析成 JSON 就存对象，否则存原字符串。 */
function record(dir: "c2s" | "s2c", line: string): void {
  let json: unknown = line;
  try { json = JSON.parse(line); } catch { /* 保留原字符串 */ }
  appendFileSync(wireLog, JSON.stringify({ ts: new Date().toISOString(), dir, json }) + "\n");
}

// Server 的 stdin/stdout 用管道接到本进程，stderr 直接继承（Server 的报错学生能直接看到）。
const child = spawn(cmd[0]!, cmd.slice(1), { stdio: ["pipe", "pipe", "inherit"], env: process.env });

child.on("error", (err) => {
  process.stderr.write(`stdio-tee：启动 Server 失败：${err.message}\n`);
  process.exit(1);
});

// driver 依赖这个文件拿到 Server 的 pid（stdout 通道被 JSON-RPC 占用，只能走文件）。
writeFileSync(join(out, "pids.tee.json"), JSON.stringify({ tee: process.pid, server: child.pid ?? null }) + "\n");

// 客户端 → Server：逐行转发。
const fromClient = createInterface({ input: process.stdin, crlfDelay: Infinity });
fromClient.on("line", (line) => {
  if (!line.trim()) return;
  record("c2s", line);
  child.stdin.write(line + "\n");
});
process.stdin.on("end", () => {
  // 只关闭 Server 的 stdin，不发信号。Server 收到 EOF 后怎么做是它自己的事。
  child.stdin.end();
});

// Server → 客户端：逐行转发。
const fromServer = createInterface({ input: child.stdout, crlfDelay: Infinity });
fromServer.on("line", (line) => {
  if (!line.trim()) return;
  record("s2c", line);
  process.stdout.write(line + "\n");
});

// Server 退出后本进程以同样的退出码退出。
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
  fromServer.once("close", () => process.exit(process.exitCode as number));
});
