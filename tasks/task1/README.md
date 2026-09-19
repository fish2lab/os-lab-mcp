# 任务 1：本地工具读文件，工具函数、库函数、系统调用都在驱动程序进程内

目标：确认 open 由驱动程序自己发出，没有子进程，只有一条到模型服务的 TCP 连接。

命令（需要 sudo，macOS 起 eslogger，Linux 起 strace）：

    npm run observe -- local

脚本直接用 node 起驱动程序，驱动程序拿到 tool_call 后在本进程 `fs.readFileSync`。模型调用进行中脚本自动拍 `lsof -nP -a -p <pid> -i` 写 net.txt（Linux 用 strace 的 connect 行）。

产物：`runs/<os>/task1/events.log`、`ps.txt`、`net.txt`、`transcript.log`、`meta.json`。

验证点（`npm run check task1` 会查）：

- events.log 有目标文件的 open 事件，pid 等于驱动程序 pid。
- events.log 没有 exec 事件。
- net.txt 有连向 443 的连接（因 keep-alive、连接关闭或 IPv6，0 到 2 条均正常），没有连向本机的连接。

记下 443 那一行的行号，任务 3 要对照。

交的东西：`runs/<os>/task1/` 整个目录，一个 commit，message 写 task1。
