// filter.ts 的单元测试。运行：node --experimental-strip-types --test observe/filter.test.ts
// 在实验里的角色：证明落盘前的三条硬约束成立——环境变量被删、外人进程被丢、socketpair 归入 ipc。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { filterEslogger, filterStrace, stripEnv, stripExecveEnv } from "./filter.ts";

const here = dirname(fileURLToPath(import.meta.url));
const esLines = readFileSync(join(here, "fixtures", "raw.eslogger.sample"), "utf8").split("\n");
const stLines = readFileSync(join(here, "fixtures", "raw.strace.sample"), "utf8").split("\n");

test("eslogger：exec 事件里的 env 被整段删除", () => {
  const out = filterEslogger(esLines, [1000]);
  const joined = out.join("\n");
  assert.ok(!joined.includes("DEEPSEEK_API_KEY"), "密钥不能落盘");
  assert.ok(!joined.includes('"env"'), "不能残留 env 键");
  const exec = out.map((l) => JSON.parse(l)).find((e) => e.event?.exec);
  assert.ok(exec, "exec 事件本身要保留");
  assert.deepEqual(exec.event.exec.args.slice(0, 1), ["node"]);
});

test("eslogger：只保留根 pid 及 fork 后代，外人 pid 被丢", () => {
  const out = filterEslogger(esLines, [1000]).map((l) => JSON.parse(l));
  const pids = new Set(out.map((e) => e.process.audit_token.pid));
  assert.ok(pids.has(1000) && pids.has(1001), "根与子进程都在");
  assert.ok(!pids.has(999), "zsh（pid 999）与根无亲缘，必须丢弃");
  assert.equal(out.length, 4, "fork、exec、open、exit 各一条");
});

test("eslogger：以子进程为根时不会反向包含父进程", () => {
  const out = filterEslogger(esLines, [1001]).map((l) => JSON.parse(l));
  assert.ok(out.every((e) => e.process.audit_token.pid === 1001));
});

test("stripEnv 深度递归，数组内的对象也处理", () => {
  const v = stripEnv({ a: { env: 1, b: [{ env: 2, c: 3 }] } }) as { a: { env?: number; b: { env?: number; c: number }[] } };
  assert.equal(v.a.env, undefined);
  assert.equal(v.a.b[0].env, undefined);
  assert.equal(v.a.b[0].c, 3);
});

test("strace：socketpair 归 ipc，connect 归 net，其余归 events", () => {
  const { events, ipc, net } = filterStrace(stLines, [2000]);
  assert.equal(ipc.length, 1);
  assert.ok(ipc[0].includes("socketpair("));
  assert.equal(net.length, 1);
  assert.ok(net[0].includes("connect(") && net[0].includes("443"));
  assert.ok(events.every((l) => !l.includes("socketpair(") && !l.includes("connect(")));
});

test("strace：CLONE_THREAD 的 clone 行丢弃，线程发出的 openat 仍保留", () => {
  const { events } = filterStrace(stLines, [2000]);
  assert.ok(events.every((l) => !l.includes("CLONE_THREAD")));
  assert.ok(events.some((l) => l.startsWith("2001 ") && l.includes("openat(")));
});

test("strace：非后代 pid 被丢，跨 unfinished/resumed 的 clone 也能建树", () => {
  const { events } = filterStrace(stLines, [2000]);
  assert.ok(!events.some((l) => l.startsWith("3000 ")), "pid 3000 不是后代");
  assert.ok(events.some((l) => l.startsWith("2003 ") && l.includes("c639e5b4.txt")), "2003 经 2002 的续行 clone 得到");
});

test("strace：execve 展开的环境变量被替换", () => {
  const { events } = filterStrace(stLines, [2000]);
  const joined = events.join("\n");
  assert.ok(!joined.includes("DEEPSEEK_API_KEY"));
  assert.ok(joined.includes("环境变量已删"));
  assert.ok(joined.includes("/* 40 vars */"), "未展开的形式原样保留");
  assert.equal(stripExecveEnv('execve("/bin/sh", ["sh"], 0x1 /* 2 vars */) = 0'), 'execve("/bin/sh", ["sh"], 0x1 /* 2 vars */) = 0');
});
