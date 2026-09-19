// http 传输的「录音机」。它在实验里的角色：
// 任务 3 中 Server 是独立起的 http 进程，driver 不再是它的父进程，所以没法像 stdio 那样夹在中间。
// 本进程监听 127.0.0.1:<teePort>，driver 把它当 Server 连；它把每个请求原样转发到真正的
// Server（127.0.0.1:<port>），并把请求体、响应体各写一行 DIR/wire.log。
// 这样任务 2 与任务 3 的 wire.log 可以逐条对比：同样的 tools/call，换了传输层，报文本身不变。
// 用法：node tee/http-tee.ts [--out DIR]（DIR 默认 runs/<os>/task3）
import { appendFileSync, mkdirSync } from "node:fs";
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import { loadParams, repoRoot } from "../verify/params.ts";

const argv = process.argv.slice(2);
const params = loadParams();
let out = join(repoRoot(), "runs", params.os, "task3");
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--out") out = argv[++i] ?? out;
  else throw new Error(`http-tee：无法识别的参数 ${argv[i]}`);
}
mkdirSync(out, { recursive: true });
const wireLog = join(out, "wire.log");

function parseBody(text: string): unknown {
  if (!text) return "";
  try { return JSON.parse(text); } catch { return text; }
}

function readAll(stream: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (c: Buffer) => chunks.push(c));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

async function forward(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readAll(req);
  const ts = new Date().toISOString();
  appendFileSync(wireLog, JSON.stringify({ ts, dir: "c2s", method: req.method, url: req.url, json: parseBody(body.toString("utf8")) }) + "\n");

  // 方法、路径、头、体全部原样转发；只把 host 改成真正的目标。
  const headers = { ...req.headers, host: `127.0.0.1:${params.port}` };
  const upstream = httpRequest(
    { host: "127.0.0.1", port: params.port, method: req.method, path: req.url, headers },
    async (up) => {
      const resBody = await readAll(up);
      appendFileSync(wireLog, JSON.stringify({ ts: new Date().toISOString(), dir: "s2c", status: up.statusCode, json: parseBody(resBody.toString("utf8")) }) + "\n");
      res.writeHead(up.statusCode ?? 502, up.headers);
      res.end(resBody);
    },
  );
  upstream.on("error", (err) => {
    appendFileSync(wireLog, JSON.stringify({ ts: new Date().toISOString(), dir: "s2c", status: 502, json: `转发失败：${err.message}` }) + "\n");
    res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    res.end(`http-tee：转发到 127.0.0.1:${params.port} 失败：${err.message}\n`);
  });
  upstream.end(body);
}

const server = createServer((req, res) => {
  forward(req, res).catch((err: Error) => {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end(`http-tee：内部错误：${err.message}\n`);
  });
});
server.listen(params.teePort, "127.0.0.1", () => {
  process.stdout.write(`http-tee 监听 127.0.0.1:${params.teePort} → 127.0.0.1:${params.port}，wire.log 写到 ${wireLog}\n`);
});
