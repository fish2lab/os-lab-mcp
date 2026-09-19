# 任务 3：MCP HTTP，Server 独立启动，与驱动程序无亲缘，介质是 TCP

目标：确认传输层换成 HTTP 后 tools/call 的消息体不变，进程模型变了。tee 在此模式是本地转发：驱动程序连 tee 端口（个人端口 + 1），tee 转发到个人端口并记录请求体与响应体。

命令，三个终端按顺序起（A、C 需要 sudo）：

    npm run observe -- server-http      # 终端 A，Server 独立启动，写 server.log
    npm run tee:http                    # 终端 B
    npm run observe -- http             # 终端 C，驱动程序

跑完后终端 A 的 Server 不要关，任务 4 的 HTTP 部分还要用。

产物：驱动侧 `runs/<os>/task3/events.log`、`wire.log`、`net.txt`、`pids.json`、`transcript.log`、`meta.json`；Server 侧 `runs/<os>/task3/server/events.log`、`server.log`、`meta.json`。

验证点（`npm run check task3` 会查）：

- 驱动侧 events.log 没有 exec 事件。
- net.txt 有两类连接：443 与本机 tee 端口，报告里分别指出行号。
- Server 侧 events.log 有目标文件的 open 事件，pid 等于 server.log 第一行记录的 pid。用 `ps -o ppid= -p <pid>` 向上追到启动它的 shell，链上没有驱动程序。
- 任务 2 与任务 3 的 tools/call 请求体 method 与 params 一致，只有 id 与外层封装不同。

交的东西：`runs/<os>/task3/` 整个目录（含 `server/` 子目录），一个 commit，message 写 task3。
