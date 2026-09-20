// 实验的「Agent 端」。它在实验里的角色：
// 这是学生眼中的 Agent 本体：拿到一条固定指令（读某个文件），把指令连同可用工具交给模型，
// 模型决定调用 read_file，工具执行后把结果交回模型，模型复述内容。
// 三种模式只换「工具在哪执行」：
//   local  工具就在本进程里 readFileSync；
//   stdio  工具在子进程 Server 里，报文走管道，中间经过 tee/stdio-tee.ts 录音；
//   http   工具在独立起的 Server 里，报文走 TCP，中间经过 tee/http-tee.ts 录音。
// 模型看到的三种模式完全一样，这是本实验要让学生亲眼确认的事。
// 所有观察材料（transcript.log、pids.json、meta.json）写到 --out 目录，observe/ 再往里加系统调用记录。
// 密钥：只从 .env 读进本进程；spawn 子进程时把它从环境里删掉，否则 Server 会平白拿到它。
import { Agent, type AgentTool } from "@earendil-works/pi-agent-core";
import { createModels, type AssistantMessage, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { Type, type TSchema } from "@sinclair/typebox";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { bridgeTools, type McpToolDetails } from "../bridge/mcp-tool.ts";
import { loadEnv, loadParams, osName, repoRoot } from "../verify/params.ts";

// ---------- 命令行 ----------
type Mode = "local" | "stdio" | "http";
interface Opts {
  mode: Mode; task: string; path: string; out: string;
  hang: boolean; dry: boolean; sandbox: boolean; noExitOnEof: boolean; noPause: boolean;
}

function usageExit(msg: string): never {
  process.stderr.write(`${msg}\n用法：node driver/run.ts --mode local|stdio|http [--task NAME] [--path P] [--out DIR] [--hang] [--dry] [--sandbox] [--no-exit-on-eof] [--no-pause]\n`);
  process.exit(2);
}

function parseArgs(argv: string[], target: string): Opts {
  const o: Partial<Opts> = { hang: false, dry: false, sandbox: false, noExitOnEof: false, noPause: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = (): string => argv[++i] ?? usageExit(`${a} 缺少参数`);
    if (a === "--mode") o.mode = next() as Mode;
    else if (a === "--task") o.task = next();
    else if (a === "--path") o.path = next();
    else if (a === "--out") o.out = next();
    else if (a === "--hang") o.hang = true;
    else if (a === "--dry") o.dry = true;
    else if (a === "--sandbox") o.sandbox = true;
    else if (a === "--no-exit-on-eof") o.noExitOnEof = true;
    else if (a === "--no-pause") o.noPause = true;
    else usageExit(`无法识别的参数 ${a}`);
  }
  if (o.mode !== "local" && o.mode !== "stdio" && o.mode !== "http") usageExit("--mode 必须是 local、stdio 或 http");
  if (!o.task) {
    if (o.hang) o.task = o.mode === "http" ? "task4-http" : "task4-stdio";
    else o.task = { local: "task1", stdio: "task2", http: "task3" }[o.mode];
  }
  o.path ??= target;
  const out = o.out ?? join("runs", osName(), o.task);
  o.out = isAbsolute(out) ? out : resolve(repoRoot(), out);
  return o as Opts;
}

// ---------- 终端颜色（只在 TTY 时加） ----------
const tty = process.stdout.isTTY === true;
const paint = (code: string) => (s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const yellow = paint("33"), cyan = paint("36"), green = paint("32"), dim = paint("2");
const say = (s: string) => process.stdout.write(s + "\n");

// ---------- 启动检查：密钥 ----------
const env = loadEnv();
const fileKey = env.DEEPSEEK_API_KEY;
if (!fileKey) { process.stderr.write("仓库根 .env 里没有 DEEPSEEK_API_KEY，先按 .env.example 填好\n"); process.exit(1); }
if (process.env.DEEPSEEK_API_KEY !== undefined && process.env.DEEPSEEK_API_KEY !== fileKey) {
  process.stderr.write("shell 环境里已有 DEEPSEEK_API_KEY 且与 .env 不同。实验要求密钥只放 .env；先 unset DEEPSEEK_API_KEY 再运行\n");
  process.exit(1);
}
process.env.DEEPSEEK_API_KEY = fileKey;
// 传给子进程的环境：去掉密钥。子进程（tee、Server）没有任何理由拿到它。
const { DEEPSEEK_API_KEY: _dropped, ...childEnvBase } = process.env as Record<string, string>;
void _dropped;

const params = loadParams();
const opts = parseArgs(process.argv.slice(2), params.target);
mkdirSync(opts.out, { recursive: true });
const started = new Date();
const transcriptFile = join(opts.out, "transcript.log");
// task0 要跑三次并对比三次 tool_call，所以 task0 的 transcript 追加；其它任务每次覆盖。
if (opts.task === "task0") {
  appendFileSync(transcriptFile, JSON.stringify({ ts: new Date().toISOString(), kind: "note", note: "run-start", task: opts.task }) + "\n");
} else {
  writeFileSync(transcriptFile, "");
}
function log(entry: Record<string, unknown>): void {
  appendFileSync(transcriptFile, JSON.stringify({ ts: new Date().toISOString(), ...entry, task: opts.task }) + "\n");
}

const isTask6 = opts.task === "task6-shell";
const SYSTEM_PROMPT = isTask6
  ? "你有一个 run_command 工具可以运行命令。用户要求时，按用户给的 cmd 与 mode 逐次调用，不要改写命令，不要合并调用。"
  : "你有工具可以读文件。用户要求读某个路径时，直接调用工具，path 参数必须与用户给出的字符串完全一致，不要展开、规范化或改写。工具返回后，把内容原样复述。";
// 任务 6：同一条命令走 shell 与 direct 两条路，比较 Server 之下的进程树。
const instruction = isTask6
  ? `用 run_command 工具运行命令「ls -l ${loadParams().root}」两次：第一次 mode 为 shell，第二次 mode 为 direct，两次都要真的调用工具。最后回答两次输出是否相同。`
  : `读取 ${opts.path} 并原样返回其内容`;
const isTask5 = opts.task.startsWith("task5") || isTask6;

// ---------- 工具来源：local 在本进程；stdio/http 经 MCP ----------
type Tool = AgentTool<TSchema, McpToolDetails>;
let client: Client | null = null;
let transport: Transport | null = null;
let teePid: number | null = null;
let serverPid: number | null = null;

/** 把经过传输层的 JSON-RPC 报文打印成青色，学生能看到 MCP 报文长什么样。 */
function tapTransport(t: Transport): void {
  const send = t.send.bind(t);
  t.send = (msg, o) => { say(cyan(`→ ${JSON.stringify(msg)}`)); return send(msg, o); };
  const inner = t.onmessage;
  t.onmessage = (msg, extra) => { say(cyan(`← ${JSON.stringify(msg)}`)); inner?.(msg, extra); };
}

function localTools(): Tool[] {
  return [{
    name: "read_file",
    label: "read_file",
    description: "读取文件文本",
    parameters: Type.Object({ path: Type.String() }),
    async execute(_id, p) {
      const { path } = p as { path: string };
      try {
        const text = readFileSync(path, "utf8");
        return { content: [{ type: "text", text }], details: { isError: false, bytes: Buffer.byteLength(text), raw: null } };
      } catch (err) {
        const message = `open failed: ${(err as Error).message}`;
        return { content: [{ type: "text", text: message }], details: { isError: true, bytes: 0, raw: message } };
      }
    },
  }];
}

function stdioServerCmd(): string[] {
  // 仅测试用：OSLAB_SERVER_CMD 可以指向别的 Server；正式实验就是 server/fs-server.ts。
  const override = process.env.OSLAB_SERVER_CMD;
  const cmd = override
    ? override.split(/\s+/).filter(Boolean)
    : [process.execPath, "--experimental-strip-types", join(repoRoot(), "server", "fs-server.ts"), "--transport", "stdio"];
  if (opts.noExitOnEof) cmd.push("--no-exit-on-eof");
  if (!opts.sandbox) return cmd;
  if (process.platform === "darwin") {
    const sb = process.env.OSLAB_SANDBOX_FILE ?? join(repoRoot(), "observe", "os-lab.sb");
    return ["sandbox-exec", "-f", sb, ...cmd];
  }
  const argsFile = process.env.OSLAB_SANDBOX_FILE ?? join(repoRoot(), "observe", "bwrap-args.txt");
  const bwrapArgs = readFileSync(argsFile, "utf8").split(/\s+/).filter(Boolean);
  return ["bwrap", ...bwrapArgs, "--", ...cmd];
}

async function waitFile(file: string, ms: number): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (existsSync(file)) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return existsSync(file);
}

async function connectMcp(): Promise<Tool[]> {
  if (opts.mode === "stdio") {
    const t = new StdioClientTransport({
      command: process.execPath,
      args: ["--experimental-strip-types", join(repoRoot(), "tee", "stdio-tee.ts"), "--out", opts.out, "--", ...stdioServerCmd()],
      env: { ...childEnvBase, OSLAB_OUT: opts.out },
      stderr: "inherit",
      cwd: repoRoot(),
    });
    transport = t;
    client = new Client({ name: "os-lab-driver", version: "0.1.0" });
    tapTransport(t);
    await client.connect(t);
    teePid = t.pid;
    // Server 的 pid 由 tee 写文件告诉我们。
    const pidFile = join(opts.out, "pids.tee.json");
    if (await waitFile(pidFile, 5000)) {
      serverPid = (JSON.parse(readFileSync(pidFile, "utf8")) as { server: number | null }).server;
    }
  } else {
    const t = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${params.teePort}/mcp`));
    transport = t;
    client = new Client({ name: "os-lab-driver", version: "0.1.0" });
    tapTransport(t);
    await client.connect(t);
    // http 模式下 Server 不是我们起的，pid 只能从它自己的日志第一行找。
    const serverLog = join(repoRoot(), "runs", osName(), "task3", "server", "server.log");
    if (existsSync(serverLog)) {
      const first = readFileSync(serverLog, "utf8").split("\n")[0] ?? "";
      const m = /\bpid=(\d+)/.exec(first);
      serverPid = m ? Number(m[1]) : null;
    }
  }
  const tools = await bridgeTools(client);
  say(dim(`Server 提供的工具：${tools.map((t) => t.name).join(", ")}`));
  return tools;
}

// ---------- 主流程 ----------
let exitCode = 0;
try {
  const tools: Tool[] = opts.mode === "local" ? localTools() : await connectMcp();

  // 暂停点：让学生此刻去另一个终端看进程树、句柄。
  if (opts.mode === "stdio" && !opts.dry && !opts.noPause) {
    say(`OSLAB-EVENT pause server=${serverPid} tee=${teePid}`);
    say("已连接 Server，尚未调用模型。现在可以在另一个终端用 ps / lsof 看进程和句柄；看完在这里按回车继续。");
    const rl = createInterface({ input: process.stdin });
    await new Promise<void>((r) => rl.once("line", () => { rl.close(); r(); }));
  }

  writeFileSync(join(opts.out, "pids.json"), JSON.stringify({ driver: process.pid, tee: teePid, server: serverPid }) + "\n");
  say("OSLAB-EVENT model-call-start");

  const wallStart = Date.now();
  let rounds = 0, costUsd = 0, modelMs = 0, tokensIn = 0, tokensOut = 0;

  const printToolCall = (name: string, args: unknown) => say(yellow(`tool_call ${JSON.stringify({ name, arguments: args })}`));
  const printToolResult = (text: string) => say(green(text.endsWith("\n") ? text.slice(0, -1) : text));

  if (opts.dry) {
    // 不调模型：直接用工具读一次，走的传输层与真实运行一样。
    const tool = tools.find((t) => t.name === "read_file") ?? usageExit("Server 没有提供 read_file 工具");
    const args = { path: opts.path };
    printToolCall("read_file", args);
    const t0 = Date.now();
    const r = await tool.execute("dry", args);
    const text = r.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    printToolResult(text);
    log({ kind: "tool", name: "read_file", arguments: args, ok: !r.details.isError, ...(r.details.isError ? { error: text } : { bytes: r.details.bytes }), ms: Date.now() - t0 });
    log({ kind: "note", note: "dry-run：未调用模型" });
  } else {
    const models = createModels();
    models.setProvider(deepseekProvider());
    const model = models.getModel("deepseek", "deepseek-v4-flash");
    if (!model) throw new Error("pi-ai 里找不到 deepseek/deepseek-v4-flash");
    // task5 要求可复现，注入 temperature 0；其余任务用默认温度。
    const streamFn = isTask5
      ? (m: typeof model, ctx: Parameters<typeof models.streamSimple>[1], o?: SimpleStreamOptions) => models.streamSimple(m, ctx, { ...o, temperature: 0 })
      : models.streamSimple.bind(models);

    const toolStart = new Map<string, number>();
    let sawToolCall = false;
    let pathRewritten = false;
    const agent = new Agent({
      initialState: { systemPrompt: SYSTEM_PROMPT, model, tools, thinkingLevel: "off" },
      streamFn,
      toolExecution: "sequential",
      async beforeToolCall({ toolCall, args }) {
        sawToolCall = true;
        printToolCall(toolCall.name, args);
        toolStart.set(toolCall.id, Date.now());
        // task5：模型把路径改写了就不让它执行，重发一次；实验要看 Server 对原始路径的反应。
        const expectedCmd = `ls -l ${loadParams().root}`;
        const badTask6 = isTask6 && (toolCall.name !== "run_command" || (args as { cmd?: string }).cmd !== expectedCmd);
        const badTask5 = !isTask6 && isTask5 && (toolCall.name !== "read_file" || (args as { path?: string }).path !== opts.path);
        if (badTask5 || badTask6) {
          pathRewritten = true;
          return { block: true, reason: "path 与要求不一致", terminate: true };
        }
        return undefined;
      },
      async afterToolCall({ toolCall, args, result, isError }) {
        const text = result.content.map((c) => (c.type === "text" ? c.text : "")).join("");
        const details = result.details as McpToolDetails | undefined;
        const failed = isError || details?.isError === true;
        printToolResult(text);
        log({ kind: "tool", name: toolCall.name, arguments: args, ok: !failed, ...(failed ? { error: text } : { bytes: details?.bytes ?? Buffer.byteLength(text) }), ms: Date.now() - (toolStart.get(toolCall.id) ?? Date.now()) });
        return failed ? { isError: true } : undefined;
      },
    });

    // 每条模型回复结束就记一条 model 条。
    let msgStart = 0;
    agent.subscribe((ev) => {
      if (ev.type === "message_start" && ev.message.role === "assistant") msgStart = Date.now();
      if (ev.type === "message_end" && ev.message.role === "assistant") {
        const m = ev.message as AssistantMessage;
        const ms = Date.now() - msgStart;
        rounds++; modelMs += ms; costUsd += m.usage.cost.total; tokensIn += m.usage.input; tokensOut += m.usage.output;
        const text = m.content.filter((c) => c.type === "text").map((c) => c.text).join("");
        const toolCalls = m.content.filter((c) => c.type === "toolCall").map((c) => ({ id: c.id, name: c.name, arguments: c.arguments }));
        log({ kind: "model", responseId: m.responseId ?? null, model: m.model, stopReason: m.stopReason, text, toolCalls,
          usage: { input: m.usage.input, output: m.usage.output, total: m.usage.totalTokens, costUsd: m.usage.cost.total }, ms });
        if (m.stopReason === "error") say(`模型调用出错：${m.errorMessage ?? "未知错误"}`);
        if (text) say(text);
      }
    });

    const maxTries = isTask5 ? 3 : 1;
    for (let attempt = 1; attempt <= maxTries; attempt++) {
      sawToolCall = false; pathRewritten = false;
      agent.reset();
      await agent.prompt(instruction);
      if (agent.state.errorMessage) { exitCode = 1; break; }
      if (!isTask5 || (sawToolCall && !pathRewritten)) break;
      if (attempt < maxTries) { log({ kind: "note", note: "path-rewritten" }); say(dim("模型改写了路径或没有调用工具，重发一次")); }
      else log({ kind: "note", note: "gave-up" });
    }
  }

  log({ kind: "summary", rounds, costUsd, wallMs: Date.now() - wallStart, modelMs });
  if (!opts.dry) say(`tokens: 输入 ${tokensIn} 输出 ${tokensOut}；费用 $${costUsd.toFixed(6)}；模型轮次 ${rounds}`);
  say("OSLAB-EVENT done");

  if (opts.hang) {
    say(`OSLAB-EVENT hang driver=${process.pid} server=${serverPid}`);
    say("停 30 秒：现在从另一个终端 kill 掉 driver，看 Server 会怎样。");
    await new Promise((r) => setTimeout(r, 30_000));
  }
} catch (err) {
  exitCode = 1;
  process.stderr.write(`driver 失败：${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
} finally {
  // 断开：stdio 下 SDK 关闭 tee 的 stdin，tee 再关闭 Server 的 stdin，然后等 tee 退出。
  const c = client as Client | null, t = transport as Transport | null;
  if (c) { try { await c.close(); } catch { /* 已经断了 */ } }
  else if (t) { try { await t.close(); } catch { /* 忽略 */ } }
  if (opts.task === "task0" || opts.dry) {
    writeFileSync(join(opts.out, "meta.json"), JSON.stringify({
      task: opts.task, os: osName(), mode: opts.mode, argv: process.argv.slice(2),
      started: started.toISOString(), ended: new Date().toISOString(), exitCode,
    }, null, 2) + "\n");
  }
}
process.exit(exitCode);
