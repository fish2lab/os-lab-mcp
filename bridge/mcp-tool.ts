// MCP 工具到 pi AgentTool 的桥。它在实验里的角色：
// 模型只认识「工具」这个抽象（名字、描述、参数 schema）；MCP Server 暴露的也是这三样。
// 本文件把 Server 在 tools/list 里报出的每个工具包成 pi 的 AgentTool：模型发起调用时，
// execute 把参数转成一条 tools/call 请求发给 Server，再把返回的文本拼起来交给模型。
// 模型看不到进程、管道、socket，这些都藏在 client 背后，这正是「接口」二字的含义。
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { TSchema } from "@sinclair/typebox";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

/** execute 返回的 details，driver 用它判断这次调用是否算错误、以及返回了多少字节。 */
export interface McpToolDetails {
  isError: boolean;
  bytes: number;
  /** Server 原始返回（content 数组）或错误信息，供日志用。 */
  raw: unknown;
}

/**
 * 向 Server 要工具清单（tools/list），每个工具映射为一个 AgentTool。
 * Server 返回 isError 或抛 JSON-RPC 错误时都以「工具错误」交给模型，不向上抛：
 * 让模型看到错误文本并作出反应，是实验里要观察的一部分。
 */
export async function bridgeTools(client: Client): Promise<AgentTool<TSchema, McpToolDetails>[]> {
  const { tools } = await client.listTools();
  return tools.map((t) => ({
    name: t.name,
    label: t.name,
    description: t.description ?? "",
    // inputSchema 就是 JSON Schema，pi 的参数校验直接用它。
    parameters: t.inputSchema as unknown as TSchema,
    async execute(_toolCallId, params) {
      const args = (params ?? {}) as Record<string, unknown>;
      try {
        const result = await client.callTool({ name: t.name, arguments: args });
        const content = (result.content ?? []) as Array<{ type: string; text?: string }>;
        const text = content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
        return {
          content: [{ type: "text", text }],
          details: { isError: result.isError === true, bytes: Buffer.byteLength(text), raw: content },
        };
      } catch (err) {
        // JSON-RPC 层的错误（例如 Server 抛 McpError「不允许读取 …」）也走这里。
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: message }],
          details: { isError: true, bytes: 0, raw: message },
        };
      }
    },
  }));
}
