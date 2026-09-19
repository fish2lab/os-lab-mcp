# 仓库接口契约（FREEZE，施工 agent 不得改写；改动先改本文）

对应指导书 `../实验指导书.html` 与教师版 `../LAB-DESIGN.md`。本文定义文件所有权、CLI、日志格式和跨模块信号。

## 0. 运行方式

- Node ≥ 22.6，所有 .ts 直接 `node --experimental-strip-types x.ts`（不能用 enum/namespace/参数属性，`import type` 必须显式）。ESM，`"type":"module"`，相对导入写 `.ts` 后缀。
- 依赖只用 package.json 里的；不要加新依赖。
- 个人参数在仓库根 `.os-lab.json`（doctor 写，提交）：
  `{"user":"<github>","salt":"<8 hex>","root":"/abs/home/os-lab","target":"/abs/home/os-lab/<salt>.txt","decoy":"/abs/home/os-lab-secret/flag.txt","port":2xxxx,"teePort":2xxxx+1,"os":"macos"|"linux"}`。
  所有模块通过 `verify/params.ts` 的 `loadParams()` 读它（verify 包负责提供，签名：`export function loadParams(): Params`，找不到就抛错「先跑 npm run doctor」）。
- 密钥只从仓库根 `.env` 读（`DEEPSEEK_API_KEY=...`），由 `verify/params.ts` 的 `loadEnv(): Record<string,string>` 解析（不用 dotenv 包）。driver 启动时若 `process.env.DEEPSEEK_API_KEY` 已存在且与 .env 不同则报错退出。
- 模型：pi-ai `createModels()` + `deepseekProvider()`，`getModel("deepseek","deepseek-v4-flash")`，`thinkingLevel:"off"`。费用取 `AssistantMessage.usage.cost.total`（USD）。

## 1. 文件所有权（每个工作包只能改自己的目录；共享文件只有本文与 package.json，由主线改）

| 包 | 目录 | 交付 |
|---|---|---|
| A server | `server/` | fs-server.ts、check.ts、check.naive.ts |
| B driver | `driver/`、`bridge/`、`tee/` | run.ts、mcp-tool.ts、stdio-tee.ts、http-tee.ts |
| C observe | `observe/` | observe.ts、observe-macos.sh、observe-linux.sh、os-lab.sb、bwrap-args.txt |
| D verify | `verify/` | params.ts、salt.ts、doctor.ts、check-run.ts |
| E docs | `README.md`、`AGENTS.md`、`tasks/*/README.md`、`PREDICTION.md`、`REPORT.md` | 学生与学生 agent 读的文档 |

## 2. 任务名与输出目录

任务名固定：task0 task1 task2 task3 task4-stdio task4-http task5-naive task5-fixed task5-sandbox。
输出目录 `runs/<os>/<task>/`，os ∈ macos|linux。task3 的 Server 侧写到 `runs/<os>/task3/server/`。
每个目录必有 `meta.json`：`{"task","os","mode","argv":[...],"started":iso,"ended":iso,"exitCode":n}`（observe 写；task0 由 driver 写）。

## 3. server/fs-server.ts

CLI：`node server/fs-server.ts --transport stdio|http [--port N] [--log FILE] [--no-exit-on-eof]`。
- 工具：`read_file {path:string}` 返回文件文本；`list_dir {path:string}` 返回每行一个名字。两者调用前都过 `check.ts` 的 `allowed(path, root)`，root 取 `loadParams().root`。校验不过：抛 `McpError(InvalidParams, "不允许读取 <path>")`（JSON-RPC error，message 以「不允许读取」开头）。
- 校验通过后直接 `fs.readFileSync`；open 失败原样把 errno 放进错误 message（格式 `open failed: EPERM: ...`，即 Node 的 err.message，其中含 errno 名）。
- stdio：`process.stdin.on("end", ...)` 默认 `process.exit(0)`；`--no-exit-on-eof` 时仍记录 stdin-end 但不退出并 `setInterval(()=>{},1000)` 保活。
- http：`StreamableHTTPServerTransport` + `enableJsonResponse: true`，无会话（sessionIdGenerator undefined），端点 `POST /mcp`，监听 `127.0.0.1:<port>`，port 默认 `loadParams().port`。
- server.log（`--log` 指定；默认 stdio 模式写到 `process.env.OSLAB_OUT/server.log`，没有 OSLAB_OUT 就不写）。每行一条：
  `<iso> pid=<pid> ppid=<ppid> event=start transport=stdio|http`
  `<iso> pid=.. event=tools/call id=<jsonrpc id> name=read_file path=<path>`
  `<iso> pid=.. event=deny path=<path>`（校验拒绝）
  `<iso> pid=.. event=open-error path=<path> errno=EPERM|ENOENT|...`
  `<iso> pid=.. event=ok path=<path> bytes=<n>`
  `<iso> pid=.. event=stdin-end`
  `<iso> pid=.. event=exit`
- check.ts 初始内容（naive，带 TODO）与 check.naive.ts 逐字节相同：
```ts
// TODO(任务 5 第 2 步)：把下面的前缀比较改成 realpath 后比较，前缀后必须紧跟路径分隔符。
export function allowed(path: string, root: string): boolean {
  return path.startsWith(root + "/");
}
```

## 4. driver/run.ts、bridge/mcp-tool.ts、tee/

CLI：`node driver/run.ts --mode local|stdio|http [--task NAME] [--path P] [--out DIR] [--hang] [--dry] [--sandbox] [--no-exit-on-eof] [--no-pause]`。
- `--task` 默认：local→task1，stdio→task2，http→task3，加 `--hang` 时 task4-stdio / task4-http。`--out` 默认 `runs/<os>/<task>`。
- 指令固定：`读取 ${target} 并原样返回其内容`；`--path P` 时把 target 换成 P。
- 系统提示（所有模式）：「你有工具可以读文件。用户要求读某个路径时，直接调用工具，path 参数必须与用户给出的字符串完全一致，不要展开、规范化或改写。工具返回后，把内容原样复述。」task5-* 时 streamFn 包装注入 `temperature: 0`；其余任务默认温度。
- local：进程内 `read_file` 工具，`fs.readFileSync(path)`，不做校验。
- stdio：driver spawn `node tee/stdio-tee.ts --out DIR -- <serverCmd...>`，serverCmd = `node server/fs-server.ts --transport stdio [--no-exit-on-eof]`，`--sandbox` 时 darwin 前缀 `sandbox-exec -f observe/os-lab.sb`，linux 前缀 `bwrap <observe/bwrap-args.txt 内容按空白切分> --`。用 SDK `StdioClientTransport`（command=process.execPath, args=[...]）。tee 的 stdio 就是 driver 拿到的 socketpair；tee 再 spawn Server。环境变量 `OSLAB_OUT=DIR` 传给 tee 与 Server。
- http：SDK `StreamableHTTPClientTransport(new URL("http://127.0.0.1:<teePort>/mcp"))`。
- bridge：`connect()` 后 `listTools()`，每个工具映射为 pi `AgentTool`（parameters 直接用 inputSchema），execute → `callTool({name, arguments})`，把 content 里的 text 拼起来返回；`isError` 时以工具错误返回给模型（不抛）。
- 流程（stdio/http）：连接 → tools/list → **暂停点**（stdio 且非 --dry 且非 --no-pause：打印 `OSLAB-EVENT pause server=<pid> tee=<pid>` 和一行中文提示，等 stdin 一行）→ 写 `pids.json` → 打印 `OSLAB-EVENT model-call-start` → `agent.prompt(指令)` → 工具执行 → 模型最终回答 → 打印 `OSLAB-EVENT done` → `--hang` 时打印 `OSLAB-EVENT hang driver=<pid> server=<pid>` 并 sleep 30 s → 断开（stdio：close transport，等 tee 退出）。
- `pids.json`：`{"driver":n,"tee":n|null,"server":n|null}`。stdio 下 server pid 来自 tee 启动后在 stdout 之外的通道：tee 把 `{"tee":pid,"server":pid}` 写到 `DIR/pids.tee.json`，driver 等该文件出现（≤5 s）后读。http 下 server pid 从 `runs/<os>/task3/server/server.log` 第一行取，取不到为 null。
- task5：`--path` 下重试至多 3 次：若模型的 tool_call.path ≠ 给定路径或没有 tool_call，记 `note=path-rewritten` 到 transcript 并重发；三次后用最后一次继续，记 `note=gave-up`。
- `--dry`：不调模型，直接用工具读一次 target（stdio/http 仍走真实 MCP），写全部文件。
- transcript.log：JSONL。每条 `{"ts":iso,"kind":"model"|"tool"|"note","task":..}`；model 条含 `responseId, model, stopReason, text, toolCalls:[{id,name,arguments}], usage:{input,output,total,costUsd}, ms`；tool 条含 `name, arguments, ok, bytes|error, ms`；note 条含 `note`。末尾一条 `{"kind":"summary","rounds":n,"costUsd":x,"wallMs":y,"modelMs":z}`。
- 终端三色（task0）：tool_call JSON 黄、JSON-RPC 报文青、Server 返回内容绿，结尾打印 token 与费用；非 TTY 不加色。
- tee/stdio-tee.ts：`--out DIR -- cmd args...`。spawn 子进程（stdio pipe），把自己 stdin 逐行转发给子进程 stdin，子进程 stdout 逐行转发给自己 stdout；每行写 `DIR/wire.log`：`{"ts":iso,"dir":"c2s"|"s2c","json":<解析后的对象或原字符串>}`。自身 stdin end → 关闭子进程 stdin（`child.stdin.end()`），不主动 kill；子进程退出后自己退出（同码）。启动后立刻写 `DIR/pids.tee.json`。
- tee/http-tee.ts：读 params，监听 `127.0.0.1:<teePort>`，把每个请求原样转发到 `127.0.0.1:<port>`（方法、路径、头、体），把请求体与响应体各写一行 wire.log（`dir":"c2s"` 请求，`"s2c"` 响应，含 `status`），`--out DIR` 默认 `runs/<os>/task3`。

## 5. observe/observe.ts + 两个 shell

CLI：`node observe/observe.ts <local|stdio|http|server-http> [driver 的其余参数原样透传]`。
- 决定 task、DIR（同 driver 默认规则；server-http → `runs/<os>/task3/server`），mkdir，写 meta.json。
- task5-sandbox：先 `cp server/check.naive.ts server/check.ts`，断言二者相同，跑完 `git checkout -- server/check.ts`，再断言 `server/check.ts` 与 naive 不同（否则打印警告「你还没提交 realpath 版」）。任何情况下不用 git stash。
- macOS（observe-macos.sh，被 observe.ts 调用，参数 `<DIR> <mode> -- <driver cmd...>`）：
  1. `sudo -v`；`sudo setsid eslogger fork exec open exit > DIR/raw.eslogger &`（必须 setsid：eslogger 抑制同进程组事件）。
  2. 起 driver（`node driver/run.ts ...`，stdio 继承 tty，stdout 同时 tee 到 `DIR/driver.out`）。observe.ts 监听 driver stdout 的 `OSLAB-EVENT` 行：`model-call-start` → 等 1 s 后 `ps -o pid,ppid,command -p <pids.json 全部>` 写 ps.txt，`lsof -nP -a -p <driver> -i` 写 net.txt（Linux 由 strace 的 connect 行代替）；`hang driver=X server=Y` → 后台轮询 `kill -0 X` 直到失败，sleep 5，`ps -p Y` 写 after-kill.txt（不存在时内容为 `pid Y not found`）。
  3. driver 退出后 `sudo pkill -f eslogger`；过滤 raw：以 pids.json 的 pid 为根，沿 fork 事件的 child 递归收集后代 pid，保留这些 pid 的事件；**删除每条 exec 事件里的 env（`event.exec.env` 或任何键名为 env 的字段）**；写 events.log（JSONL）。server-http 模式的根 pid 为 Server 自己（从 server.log 第一行取）。
  4. task5-sandbox：`/usr/bin/log show --last 3m --predicate 'eventMessage CONTAINS "os-lab-secret"' > DIR/sandbox.log`（允许为空）。
- Linux（observe-linux.sh）：`strace -f -ttt -o DIR/raw.strace -e trace=process,ipc,network,file,desc node driver/run.ts ...`；结束后过滤：clone 含 CLONE_THREAD 的行丢弃；`socketpair(` 行 → ipc.txt；`connect(` 行 → net.txt；其余 → events.log（文本行，保留 strace 原格式，行首 pid）。同样删掉 execve 行里的 envp 数组（strace 默认只打印 `0x...` 个数，但 `-v` 时会展开；不要加 -v）。
- 沙箱文件：`os-lab.sb` 用 `(version 1)(allow default)(deny file-read* (subpath "<decoy 的目录>"))`，observe.ts 在运行前用 params 生成到 `DIR/os-lab.sb`（模板里的 `observe/os-lab.sb` 是带 `__SECRET_DIR__` 占位的模板）。`bwrap-args.txt` 一行：`--ro-bind / / --dev /dev --proc /proc --tmpfs __SECRET_DIR__ --unshare-user --die-with-parent`，同样替换后写到 DIR。driver 的 `--sandbox` 读 `OSLAB_SANDBOX_FILE`（observe.ts 设置为生成后的文件路径）。

## 6. verify/

- `params.ts`：`loadParams()`、`loadEnv()`、`repoRoot()`（从 import.meta 向上找 package.json）、`osName()`（darwin→macos，其它→linux）。
- `salt.ts`：`derive(user)`：`salt = sha256(user).hex.slice(0,8)`，`port = 20000 + parseInt(sha256(user).hex.slice(8,12),16) % 10000`（若 <1024 不可能），target/decoy 路径按 §0。
- `doctor.ts`：检查 node 版本、git、`gh api user -q .login`（失败则用 .env 的 GITHUB_USER，再失败报错）、macOS 的 eslogger/lsof/sandbox-exec 或 Linux 的 strace/lsof/bwrap 存在、`sudo -n true` 或提示、shell env 里没有 DEEPSEEK_API_KEY（有则报错退出并解释）、.env 有密钥；用 pi-ai 发一次最小请求（「回复 OK」）打印 responseId 与费用；创建 root 目录与 target（内容 `os-lab <user> <salt>\n`）、decoy 目录与 decoy（`FLAG{<16 hex 随机>}\n`）；写 `.os-lab.json`；macOS 下试跑 `sudo eslogger exec` 2 秒判断完全磁盘访问（失败给出系统设置路径）；把每项 通过/未通过 写成 `DOCTOR.md` 表格并打印。
- `check-run.ts <task>`：读 `runs/<os>/<task>/`，按指导书「验证点」逐条断言，输出 `PASS/FAIL <断言> (<文件>:<行>)`，最后统计；非 0 退出码表示有 FAIL。断言清单（最少）：
  - task0：transcript 三个 model 条有 toolCalls[0].name=read_file；三次 path 指向同一 realpath。
  - task1：events.log 含 open 事件且 pid=driver；无 exec 事件；net.txt 含 `:443`。
  - task2：exec 事件恰 2 条且第二条 argv 含 fs-server；open(target) 的 pid=server≠driver；ps.txt 里 server 的 ppid=tee，tee 的 ppid=driver；wire.log 顺序 initialize→notifications/initialized→tools/list→tools/call；handles.txt 存在且含 `unix`（或 `socket:`）和 `PIPE`（或 `pipe:`）。
  - task3：driver 侧无 exec；net.txt 含 `:443` 与 `:<teePort>`；server 侧 events.log 有 open(target) 且 pid=server.log 的 pid；两任务 tools/call 的 params 深相等。
  - task4-stdio：after-kill.txt 含 not found；server.log 含 stdin-end；events.log 有 server 的 exit。task4-http：after-kill.txt 含 server pid 行；server.log 无新增（行数与 task3 结束时一致，允许 ±0）。
  - task5-naive：wire.log s2c 含 `FLAG{`；events.log 有 open(decoy) pid=server。task5-fixed：wire.log s2c 有 error 且 message 含「不允许读取」；events.log 无 open(decoy)。task5-sandbox：macos：s2c error message 含 EPERM 且 events.log 有 open(decoy)；linux：error 含 ENOENT。

## 7. 验收命令（每个包做完必须通过）

- 全部：`npm run typecheck`。
- A：`echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}' | OSLAB_OUT=/tmp/x node --experimental-strip-types server/fs-server.ts --transport stdio` 输出含 `"result"`；http 模式 curl POST /mcp 同样。
- B：`node --experimental-strip-types driver/run.ts --mode stdio --dry --no-pause --out /tmp/b`，产生 wire.log（4 条 c2s）、pids.json、transcript.log；`--mode local --dry` 同；有真实密钥时 `--mode stdio --no-pause --out /tmp/b2` 产生含 responseId 的 transcript。
- C：`node --experimental-strip-types observe/observe.ts local --dry`（无 sudo 时脚本应明确报错「需要 sudo」而不是静默）；shell 脚本 `bash -n` 通过；过滤函数用 `observe/fixtures/raw.eslogger.sample` 做单测（自备 3 条样例）。
- D：`node --experimental-strip-types verify/salt.ts fish2lab` 打印参数；`npm run check task2` 对 `verify/fixtures/task2/` 样例全 PASS。
- E：`tasks/` 下九个目录各有 README.md，命令与本文一致；README.md 快速开始 6 步。
