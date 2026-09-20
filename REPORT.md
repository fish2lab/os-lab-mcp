# 实验报告：Agent 经 MCP 访问 OS 资源，证据来自本人 runs/ 目录

姓名：　学号：　GitHub 用户名：　salt：　系统（macos 或 linux）：　总费用（USD，各 transcript.log 的 summary 条相加）：

每个任务写一段，不超过 150 字。每段必须写出证据所在的文件与行号，形如 `runs/macos/task2/events.log:37`，并说明这一行为什么能证明该任务的结论。无引用或引用不成立不得分。`runs/` 里的文件不改，报告里只引用。验证点与实测不符的，写差异与原因。

## 任务 0：模型输出了什么，宿主替它做了什么

证据：`runs/<os>/task0/transcript.log:`
叙述：

## 任务 1：本地工具读文件，open 由哪个进程发出

证据：`runs/<os>/task1/events.log:`　`net.txt:`
叙述：

## server：自己写的 Server 通过了哪些断言，deny 与 open-error 两种日志行分别在什么条件下出现

证据：`npm run check server` 的输出；server.log 行号
叙述：

## 任务 2：Server 是谁的子进程，介质是什么，open 发生在哪里

证据：`runs/<os>/task2/events.log:`　`ps.txt:`　`wire.log:`　`handles.txt:`
叙述：

## 任务 3：传输层换成 HTTP 后，消息层与进程模型各有什么变化

证据：`runs/<os>/task3/net.txt:`　`runs/<os>/task3/server/events.log:`　`server.log:`　两个 wire.log 的 tools/call 各一行
叙述：

## 任务 4：杀死驱动程序后，两种 Server 的表现分别来自介质还是代码约定

证据：`runs/<os>/task4-stdio/after-kill.txt:`　`server.log:`　对照组的 `after-kill.txt:`　`runs/<os>/task4-http/after-kill.txt:`
叙述：

## 任务 5：三次运行的拒绝各在哪一层

证据：三个目录各自 `wire.log:` 与 `events.log:`（没有 open 事件的写查找命令与结果）；`git show <commit> -- server/check.ts`；沙箱规则所在行
叙述：

## 任务 6：shell 与 direct 两种执行的 fork/exec 树有什么不同

证据：`runs/<os>/task6-shell/transcript.log:`　`events.log:`（两次调用各自的 fork 与 exec 行）
叙述：

## 思考题七道，每题要引用本人证据文件的文件名与行号

1. 结合任务 0 的 `transcript.log` 与任务 2 的 `events.log`、`wire.log`，画出从模型到文件的完整调用链，标注每段所在进程及该进程由谁创建。
2. 任务 2 比任务 1 多出哪些事件？分别由进程模型还是 IPC 介质触发？Node 为何用 socketpair 而非两根匿名管道？对模型服务的 TCP 连接有无变化，为何？
3. 对比任务 2、3 的 tools/call 请求体，说明 MCP 为何分离传输层与消息层。只保留 stdio 时，任务 3 的哪些能力会失去？
4. 任务 4 中两种 Server 的表现有何不同？哪部分来自介质（对端关闭时读端得到什么），哪部分来自代码约定？stdio 为何天然一对一？
5. 任务 5 三次运行的拒绝各在哪一层？realpath 校验仍可能被什么绕过（提示：检查之后、打开之前替换符号链接）？该绕过在沙箱层是否成立？macOS 与 Linux 的两种拒绝有何不同？
6. 从操作系统接口设计的角度，比较 tools/list、tools/call 与「系统调用号 + 统一入口」的相通与不同。
7. 任务 6 里 `sh -c "ls -l"` 在 eslogger 中为什么有时只有一次 fork 却有两次 exec？这与 shell 对单条简单命令的处理方式有什么关系？direct 模式下这两个事件各有几次？

## 预测与实测不一致的地方逐条解释

从 `PREDICTION.md` 的四项里摘出每一处不一致，写成「预测、实测（文件与行号）、原因」三部分。没有不一致的写「无」。

## 总结不少于 400 字，围绕 OS 接口如何被 Agent 使用、三种方式的差异与安全边界
