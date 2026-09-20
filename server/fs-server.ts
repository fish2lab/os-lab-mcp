// MCP 文件服务器骨架（实验里的「Server 进程」）。这个文件由你补完。
//
// 它的角色：driver（Agent 那一侧）通过 MCP 把「读文件」「列目录」「跑命令」的请求交给这个进程，
// 由这个进程替 Agent 去调 open/read/fork/exec 等系统调用。任务 2/3 观察它如何被 fork/exec、
// 如何在管道或 TCP 上收发 JSON-RPC；任务 4 观察它在客户端退出后的生死；任务 5 观察路径校验
// （server/check.ts）与操作系统沙箱两道防线；任务 6 观察它替 Agent 执行命令时的进程树。
//
// 已给：命令行解析、日志函数、错误构造、http 传输分支（SDK 样板）、启动流程。
// 要补：标了 TODO 1 到 TODO 5 的五处。补完用 `npm run check server` 验收。
// 日志格式是检查器逐行解析的，见 docs/CONTRACT.md §3，不要改格式。
//
// 用法：node server/fs-server.ts --transport stdio|http [--port N] [--log FILE] [--no-exit-on-eof]

import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { dirname, join } from "node:path";
import { z } from "zod";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from "@modelcontextprotocol/sdk/types.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { loadParams } from "../verify/params.ts";
import { allowed } from "./check.ts";

// ---------- 命令行参数（已给） ----------

interface Cli {
  transport: "stdio" | "http";
  port: number | undefined;
  log: string | undefined;
  exitOnEof: boolean;
}

function parseCli(argv: string[]): Cli {
  const cli: Cli = { transport: "stdio", port: undefined, log: undefined, exitOnEof: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--transport") {
      const v = argv[++i];
      if (v !== "stdio" && v !== "http") throw new Error(`--transport 只能是 stdio 或 http，收到 ${v}`);
      cli.transport = v;
    } else if (a === "--port") {
      cli.port = Number(argv[++i]);
      if (!Number.isInteger(cli.port) || cli.port <= 0) throw new Error("--port 需要一个正整数");
    } else if (a === "--log") {
      cli.log = argv[++i];
      if (!cli.log) throw new Error("--log 需要一个文件路径");
    } else if (a === "--no-exit-on-eof") {
      cli.exitOnEof = false;
    } else {
      throw new Error(`未知参数 ${a}`);
    }
  }
  return cli;
}

// ---------- 日志（已给） ----------
// 每行：<iso> pid=<pid> <fields>。可用的 fields 见 docs/CONTRACT.md §3：
//   event=start ppid=.. transport=..   event=tools/call id=.. name=.. path=..
//   event=deny path=..                 event=open-error path=.. errno=..
//   event=ok path=.. bytes=..          event=run_command mode=.. cmd=..
//   event=stdin-end                    event=exit

let logFile: string | undefined;

function logLine(fields: string): void {
  if (!logFile) return;
  const line = `${new Date().toISOString()} pid=${process.pid} ${fields}\n`;
  try {
    appendFileSync(logFile, line);
  } catch (err) {
    // stdout 是协议通道，不能污染，所以只能往 stderr 提醒。
    process.stderr.write(`写日志失败 ${logFile}: ${(err as Error).message}\n`);
  }
}

// ---------- 工具函数（已给） ----------

const pathArgs = z.object({ path: z.string() });
const cmdArgs = z.object({ cmd: z.string(), mode: z.enum(["shell", "direct"]) });

// SDK 的 McpError 会在 message 前面加「MCP error <code>: 」；检查器要求客户端看到的 message
// 逐字就是我们给的文本，所以构造后把 message 改回来。
function mcpError(code: ErrorCode, message: string): McpError {
  const err = new McpError(code, message);
  err.message = message;
  return err;
}

// 从 Node 的错误对象里取 errno 名（EPERM、ENOENT……）。
function errnoOf(err: unknown): string {
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" ? code : "UNKNOWN";
}

function textResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

// ---------- 工具实现（要补） ----------

// TODO 1：校验。allowed(path, root) 不通过时记一行 event=deny，并抛出
// mcpError(ErrorCode.InvalidParams, `不允许读取 ${path}`)。通过则什么都不做。
function checkOrDeny(path: string, root: string): void {
  void path; void root; void allowed; void logLine; void mcpError;
  throw mcpError(ErrorCode.InternalError, "TODO 1 未实现：checkOrDeny");
}

// TODO 2：read_file。先 checkOrDeny，再 readFileSync(path, "utf8")。
// 读失败：记 event=open-error path=.. errno=..，抛 mcpError(ErrorCode.InternalError, `open failed: ${err.message}`)。
// 成功：记 event=ok path=.. bytes=..，返回 textResult(text)。
function readFileTool(path: string, root: string): CallToolResult {
  void path; void root; void readFileSync; void errnoOf; void textResult;
  throw mcpError(ErrorCode.InternalError, "TODO 2 未实现：read_file");
}

// TODO 3：list_dir。同 read_file，只是用 readdirSync，返回的文本是名字按行拼接。
function listDirTool(path: string, root: string): CallToolResult {
  void path; void root; void readdirSync;
  throw mcpError(ErrorCode.InternalError, "TODO 3 未实现：list_dir");
}

// TODO 4：run_command（可以留到任务 6 再写，但 `npm run check server` 要它能用）。记 event=run_command mode=.. cmd=..，然后
//   mode === "shell"  → execFileSync("/bin/sh", ["-c", cmd], { encoding: "utf8" })
//   mode === "direct" → 把 cmd 按空白切成 argv，execFileSync(argv[0], argv.slice(1), { encoding: "utf8" })
// 返回 textResult(标准输出)。失败抛 mcpError(ErrorCode.InternalError, `run_command failed: ${err.message}`)。
// 这个工具不做路径校验：任务 6 只看进程树。
function runCommandTool(cmd: string, mode: "shell" | "direct"): CallToolResult {
  void cmd; void mode; void execFileSync;
  throw mcpError(ErrorCode.InternalError, "TODO 4 未实现：run_command");
}

// ---------- MCP Server（tools/list 与 tools/call 已接好，工具表要补） ----------
// 这里用 SDK 的底层 Server 类：处理函数里抛出的 McpError 会原样变成 JSON-RPC error 返回。

function buildServer(root: string): Server {
  const server = new Server({ name: "os-lab-fs-server", version: "0.1.0" }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "read_file",
        description: "读取一个文件的文本内容。path 必须是绝对路径。",
        inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      },
      {
        name: "list_dir",
        description: "列出一个目录里的名字，每行一个。path 必须是绝对路径。",
        inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      },
      {
        name: "run_command",
        description: "运行一条命令并返回其标准输出。mode 为 shell 时经 /bin/sh -c 执行，为 direct 时按空白切分后直接执行。",
        inputSchema: {
          type: "object",
          properties: { cmd: { type: "string" }, mode: { type: "string", enum: ["shell", "direct"] } },
          required: ["cmd", "mode"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const name = request.params.name;
    // extra.requestId 就是这条 tools/call 的 JSON-RPC id，写进日志便于和 wire.log 对照。
    if (name === "run_command") {
      const c = cmdArgs.safeParse(request.params.arguments ?? {});
      if (!c.success) throw mcpError(ErrorCode.InvalidParams, "工具 run_command 的参数不合法：需要 {cmd: string, mode: shell|direct}");
      logLine(`event=tools/call id=${String(extra.requestId)} name=run_command cmd=${c.data.cmd}`);
      return runCommandTool(c.data.cmd, c.data.mode);
    }
    const parsed = pathArgs.safeParse(request.params.arguments ?? {});
    if (!parsed.success) throw mcpError(ErrorCode.InvalidParams, `工具 ${name} 的参数不合法：需要 {path: string}`);
    const path = parsed.data.path;
    logLine(`event=tools/call id=${String(extra.requestId)} name=${name} path=${path}`);
    if (name === "read_file") return readFileTool(path, root);
    if (name === "list_dir") return listDirTool(path, root);
    throw mcpError(ErrorCode.InvalidParams, `没有名为 ${name} 的工具`);
  });

  return server;
}

// ---------- 启动 ----------

async function main(): Promise<void> {
  const cli = parseCli(process.argv.slice(2));
  const params = loadParams();

  logFile = cli.log;
  if (!logFile && cli.transport === "stdio" && process.env.OSLAB_OUT) {
    logFile = join(process.env.OSLAB_OUT, "server.log");
  }
  if (logFile) mkdirSync(dirname(logFile), { recursive: true });

  // 第一行必须是 start 且带 ppid：任务 2 用它核对 Server 的父进程，任务 4 用它找 Server 的 pid。
  logLine(`event=start ppid=${process.ppid} transport=${cli.transport}`);
  process.on("exit", () => logLine("event=exit"));
  process.on("SIGINT", () => process.exit(0));
  process.on("SIGTERM", () => process.exit(0));

  const server = buildServer(params.root);

  if (cli.transport === "stdio") {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    // TODO 5：客户端把管道写端关掉时，process.stdin 会收到 "end" 事件。
    // 收到后记一行 event=stdin-end；cli.exitOnEof 为真就 process.exit(0)，
    // 否则用 setInterval(() => {}, 1000) 让事件循环别空掉（任务 4 用它演示子进程可以活过父进程）。
    // 想清楚：如果这里什么都不写，进程会在 EOF 后退出吗？先猜，再用任务 4 验证。
    void cli.exitOnEof;
    return;
  }

  // http（已给）：无会话的 Streamable HTTP。SDK 1.30 规定无会话 transport 只能服务一次请求，
  // 所以每个 POST /mcp 都新建一对 Server + transport，响应结束后关掉。每次往返彼此独立，
  // 这正是任务 3 里「Server 不记得上一条请求」的来源。
  const port = cli.port ?? params.port;
  const httpServer = createHttpServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/mcp") {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("只有 /mcp 这一个端点\n");
      return;
    }
    const server = buildServer(params.root);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    server
      .connect(transport)
      .then(() => transport.handleRequest(req, res))
      .catch((err: unknown) => {
        process.stderr.write(`处理请求失败: ${(err as Error).message}\n`);
        if (!res.headersSent) res.writeHead(500).end();
      });
  });
  httpServer.listen(port, "127.0.0.1", () => {
    process.stdout.write(`listening http://127.0.0.1:${port}/mcp\n`);
  });
}

main().catch((err: unknown) => {
  process.stderr.write(`fs-server 启动失败: ${(err as Error).message}\n`);
  process.exit(1);
});
