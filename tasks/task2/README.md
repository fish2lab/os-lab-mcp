# 任务 2：MCP stdio，Server 是子进程，介质是 socket 对，open 发生在子进程

目标：看到驱动程序拉起 tee、tee 拉起 Server 的两次 exec，看到 Server 的 fd 0、1 是 unix socket。

命令（需要 sudo）：

    npm run observe -- stdio

驱动程序发 tools/call 前会暂停，打印 `OSLAB-EVENT pause server=<pid> tee=<pid>`。这时另开终端，macOS 跑 `lsof -p <Server pid>`，Linux 跑 `ls -l /proc/<Server pid>/fd`，输出粘进 `runs/<os>/task2/handles.txt`。再做对照组：`sleep 30 | cat &`，对 cat 的 pid 执行同一命令，也粘进 handles.txt。回到原终端按回车继续。

产物：`runs/<os>/task2/events.log`、`wire.log`、`handles.txt`（手工粘贴）、`ps.txt`、`pids.json`、`transcript.log`、`meta.json`，Linux 另有 `ipc.txt`。

验证点（`npm run check task2` 会查）：

- events.log 恰有两条 exec，第二条 argv 含 fs-server。macOS 每条 exec 前有 fork 事件，child 字段是新 pid。
- 目标文件 open 事件的 pid 等于 Server pid，不等于驱动程序 pid。
- ps.txt 里 Server 的 ppid 是 tee，tee 的 ppid 是驱动程序。
- wire.log 依次为 initialize、notifications/initialized、tools/list、tools/call，id 递增。
- handles.txt 存在，含 unix（Linux 为 socket:）和 PIPE（Linux 为 pipe:）。Linux 的 ipc.txt 有 socketpair(AF_UNIX, SOCK_STREAM, …)，没有 pipe2。

交的东西：`runs/<os>/task2/` 整个目录，一个 commit，message 写 task2。
