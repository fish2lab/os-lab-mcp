# 任务 6：同一条 ls -l 经 sh -c 执行比直接 exec 多一层 sh 进程，两棵 fork/exec 树在 events.log 里可以比较

目标：看到 shell 模式多出一层 sh 进程，看清 shell 对单条简单命令是再 fork 一次还是直接 exec。

前提：`server/fs-server.ts` 已有 run_command 工具（server 任务 TODO 4）且 `npm run check server` 通过。当时没写的在此补上，一个 commit，message 写 run_command。

命令（需要 sudo）：

    npm run observe -- stdio --task task6-shell

驱动程序温度设 0，指令要求模型用 run_command 以 shell 与 direct 各运行一次 `ls -l <白名单目录>`，最后回答两次输出是否相同。

产物：`runs/<os>/task6-shell/transcript.log`、`events.log`、`wire.log`、`server.log`、`pids.json`、`meta.json`。

看日志：以 Server pid 为根，把两次调用各自的 fork 与 exec 事件按时间列出，标出每个 exec 的 args[0] 与父 pid。macOS 的 fork 事件有 child 字段，exec 事件有 args；Linux 看 clone 与 execve 行的 pid。

验证点（`npm run check task6-shell` 会查）：

- transcript.log 有两条 run_command 工具调用，mode 分别为 shell、direct。
- events.log 中 Server 的后代有 exec 事件，args[0] 以 sh 结尾且含 `-c`。
- exec 事件里 args[0] 以 ls 结尾的至少 2 条。
- 父为 Server 的 fork 事件至少 2 条。
- 所有 exec 事件的 env 字段已删。

交的东西：`runs/<os>/task6-shell/` 整个目录，一个 commit，message 写 task6-shell。
