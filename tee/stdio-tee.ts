// stdio 传输的「录音机」骨架。这个文件由你补完（任务 2）。
//
// 它的角色：driver 把它当成 Server 启动（driver 的子进程是它，它再 spawn 真正的 Server），
// 于是 driver 与 Server 之间每一行 JSON-RPC 报文都经过它：原样转发，并写进 DIR/wire.log。
// 它不主动杀 Server：自己 stdin 关闭时只关闭 Server 的 stdin，Server 是否退出由 Server 自己决定，
// 这是任务 4 观察「客户端没了，Server 怎么办」的前提。
//
// 已给：参数解析、record() 写 wire.log、spawn Server、写 pids.tee.json。要补：TODO 1 到 TODO 4。
// 参照：tee/http-tee.ts 是同一件事在 TCP 上的成品。
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

/** 每行报文写一条记录；能解析成 JSON 就存对象，否则存原字符串。检查器按这个格式读。 */
function record(dir: "c2s" | "s2c", line: string): void {
  let json: unknown = line;
  try { json = JSON.parse(line); } catch { /* 保留原字符串 */ }
  appendFileSync(wireLog, JSON.stringify({ ts: new Date().toISOString(), dir, json }) + "\n");
}

// 已给：用 spawn 启动 Server：cmd[0] 是程序，cmd.slice(1) 是参数。
// stdin 与 stdout 要用 "pipe"（本进程要读写它们），stderr 用 "inherit"（Server 的报错直接给人看）。
// 环境变量传 process.env（driver 已经把密钥删掉了，任务 2 会验证这一点）。
const child = spawn(cmd[0]!, cmd.slice(1), { stdio: ["pipe", "pipe", "inherit"], env: process.env });
child.on("error", (err) => {
  process.stderr.write(`stdio-tee：启动 Server 失败：${err.message}\n`);
  process.exit(1);
});

// driver 靠这个文件拿到 Server 的 pid（stdout 通道被 JSON-RPC 占用，只能走文件）。
writeFileSync(join(out, "pids.tee.json"), JSON.stringify({ tee: process.pid, server: child.pid ?? null }) + "\n");

// TODO 1：客户端 → Server。用 createInterface({ input: process.stdin, crlfDelay: Infinity }) 逐行读本进程 stdin，
// 每行（跳过空行）先 record("c2s", line)，再写到 child.stdin（记得补回换行：MCP 的 stdio 传输以换行分帧）。
void createInterface;

// TODO 2：本进程 stdin 收到 "end" 时，只调用 child.stdin.end()。不要 kill。
// 想清楚：Server 收到的是什么？一个信号，还是 read() 返回 0？任务 4 会验证。

// TODO 3：Server → 客户端。逐行读 child.stdout，每行 record("s2c", line) 后写到 process.stdout。

// TODO 4：Server 退出后本进程以同一退出码退出。处理 child 的 "exit"：把退出码存进 process.exitCode，
// 等 TODO 3 那条 readline 触发 "close"（stdout 已读完）后再 process.exit，否则最后几行会丢。
void record;
