# 实验报告：Agent 经 MCP 访问 OS 资源，证据来自本人 runs/ 目录

姓名：　学号：　GitHub 用户名：　salt：　系统（macos 或 linux）：　总费用（USD，各 transcript.log 的 summary 条相加）：

每个数值、每条论断后面注明证据文件名与行号，形如 `runs/macos/task2/events.log:37`。无引用或引用不成立不得分。`runs/` 里的文件不改，报告里只引用。

## 表 5-1 三种调用方式对比，每格填值并注明来自哪个文件的第几行

| 指标 | 本地工具（T1） | MCP stdio（T2） | MCP HTTP（T3） |
|---|---|---|---|
| 目标文件 open 事件所在 pid 及其进程 | | | |
| Server 的 ppid 及向上追到哪里 | 无 Server | | |
| IPC 介质（无 / unix socket 对 / TCP）及证据 | | | |
| 一次 tools/call 请求字节数 | 无 | | |
| 驱动程序是否有 exec 事件 | | | |
| 端到端耗时（ms）及其中模型调用耗时 | | | |
| 对模型服务的 TCP 连接（net.txt 行号） | | | |
| 对本机的 TCP 连接（net.txt 行号） | 无 | 无 | |
| Server 进程内事件总数（同系统内比较） | 无 Server | | |

## 表 5-2 生命周期与安全边界，每格填值并注明来自哪个文件的第几行

| 场景 | 模型是否原样发出路径 | wire.log 响应 | 目标文件 open 事件及结果 | 拒绝或退出发生在哪一层 |
|---|---|---|---|---|
| 杀死驱动程序，stdio | 不适用 | | | |
| 杀死驱动程序，HTTP | 不适用 | | | |
| naive 校验 + 穿越路径 | | | | |
| realpath 校验 + 穿越路径 | | | | |
| 沙箱 + naive 校验 + 穿越路径 | | | | |

## 任务 0 看模型输出什么、宿主替它做什么

贴：`runs/<os>/task0/transcript.log` 中三条 model 记录的 `toolCalls` 字段。
答：三次 tool_call 的 path 参数是否相同，`~` 有没有被展开，三次 path 指向的是否同一文件。模型输出里除了工具名与路径参数还有什么。

## 任务 1 本地工具读文件，全部在同一进程内

贴：`runs/<os>/task1/events.log` 中目标文件的 open 事件那一行，`ps.txt` 全文，`net.txt` 全文。
答：open 事件的 pid 是否等于驱动程序 pid。有没有 exec 事件。`net.txt` 里连向 443 的连接有几条，有没有连向本机的连接。记下 443 那一行的行号，任务 3 对照。

## 任务 2 MCP stdio，Server 是子进程，介质是 socket 对

贴：`runs/<os>/task2/events.log` 中两条 exec 事件与目标文件 open 事件（macOS 连同 exec 前的 fork 事件），`ps.txt` 全文，`wire.log` 四条 c2s 报文的 method 与 id，`handles.txt` 中 Server 与 cat 的 fd 0、1 两行（Linux 另贴 `ipc.txt`）。
答：两次 exec 各由谁发起，argv 分别是什么。open 事件的 pid 是否等于 Server pid、是否不等于驱动程序 pid。`ps.txt` 里 Server 的 ppid 是谁，tee 的 ppid 是谁。`wire.log` 的顺序与 id 是否递增。Server 的 fd 0、1 是 unix 还是 PIPE，对照组 cat 的 fd 0 是什么。

## 任务 3 MCP HTTP，传输层换了，消息层不变，进程模型变了

贴：`runs/<os>/task3/events.log` 中的 exec 事件（应为空，贴查找命令与结果），`net.txt` 全文，`runs/<os>/task3/server/events.log` 中目标文件的 open 事件，`server/server.log` 第一行与 tools/call 那一行，任务 2 与任务 3 `wire.log` 中 tools/call 请求体各一条。
答：驱动侧有没有 exec。`net.txt` 里 443 与本机 tee 端口各在第几行。Server 侧 open 事件的 pid 是否等于 `server.log` 记录的 pid，用 `ps -o ppid=` 向上追到哪里，链上有没有驱动程序。两个 tools/call 请求体的 method 与 params 是否一致，哪些字段不同。

## 任务 4 一端被杀后，另一端的表现来自介质还是代码约定

贴：`runs/<os>/task4-stdio/after-kill.txt`、`server.log` 中 stdin-end 与 exit 两行、`events.log` 中 Server 的 exit 事件；`runs/<os>/task4-http/after-kill.txt`，`runs/<os>/task3/server/server.log` 在任务 3 结束时与任务 4 结束时的行数。选做：`--no-exit-on-eof` 一次的 `after-kill.txt` 与 `server.log`。
答：stdio 下 Server 是否退出，退出前 `server.log` 记了什么。HTTP 下 Server 是否还在，`server.log` 有没有新增。选做的结果如何。

## 任务 5 三次运行的拒绝各在哪一层，并修复用户态漏洞

贴：三个目录（task5-naive、task5-fixed、task5-sandbox）各自 `wire.log` 中 tools/call 的 s2c 响应一条、`events.log` 中诱饵文件的 open 事件（没有就贴查找命令与结果）、`server.log` 中 deny 或 open-error 一行；`server/check.ts` 修复的 diff（`git show <commit> -- server/check.ts`）；`transcript.log` 中带 note 的记录（模型改写路径时才有）；macOS 另贴 `sandbox.log`（为空也贴）。
答：第 1 次 `wire.log` 是否返回诱饵内容，open 事件在哪个 pid。第 2 次的错误文本是什么，有没有诱饵文件的 open 事件。第 3 次的错误文本是什么（macOS 为 EPERM，Linux 为 ENOENT），有没有 open 事件。第 2、3 次都返回错误，凭什么判断拒绝在不同层。模型有没有改写路径，重试了几次。

## 思考题六道，每题要引用本人证据文件的文件名与行号

1. 结合任务 0 的 `transcript.log` 与任务 2 的 `events.log`、`wire.log`，画出从模型到文件的完整调用链，标注每段所在进程及该进程由谁创建。
2. 任务 2 比任务 1 多出哪些事件？分别由进程模型还是 IPC 介质触发？Node 为何用 socketpair 而非两根匿名管道？对模型服务的 TCP 连接有无变化，为何？
3. 对比任务 2、3 的 tools/call 请求体，说明 MCP 为何分离传输层与消息层。只保留 stdio 时，任务 3 的哪些能力会失去？
4. 任务 4 中两种 Server 的表现有何不同？哪部分来自介质（对端关闭时读端得到什么），哪部分来自代码约定？stdio 为何天然一对一？
5. 任务 5 三次运行的拒绝各在哪一层？realpath 校验仍可能被什么绕过（提示：检查之后、打开之前替换符号链接）？该绕过在沙箱层是否成立？macOS 与 Linux 的两种拒绝有何不同？
6. 从操作系统接口设计的角度，比较 tools/list、tools/call 与「系统调用号 + 统一入口」的相通与不同。

## 预测与实测不一致的地方逐条解释

从 `PREDICTION.md` 里摘出每一处不一致，写成「预测、实测（文件与行号）、原因」三部分。没有不一致的写「无」。

## 总结不少于 400 字，围绕 OS 接口如何被 Agent 使用、三种方式的差异与安全边界

