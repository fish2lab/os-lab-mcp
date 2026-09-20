# 任务 4 stdio：杀死驱动程序后 Server 退出，退出来自你在 server 任务里写的 stdin 结束处理

目标：区分退出行为中来自介质的部分与来自代码约定的部分。约定是 server 任务 TODO 7 写的 `process.stdin.on("end", ...)`，tee 读到 EOF 时关闭 Server 的 stdin（stdio-tee TODO 4）。

命令（需要 sudo）：

    npm run observe -- stdio --hang

驱动程序收到结果后打印 `OSLAB-EVENT hang driver=<pid> server=<pid>` 并保持 30 秒。30 秒内另开终端执行 `kill -9 <驱动程序 pid>`。脚本 5 秒后自动 `ps -p <Server pid>` 写 after-kill.txt。

对照组（去掉约定并挂一个空定时器，重复上面的 kill 步骤，结果写进报告）：

    npm run observe -- stdio --hang --no-exit-on-eof

产物：`runs/<os>/task4-stdio/after-kill.txt`、`server.log`、`events.log`、`wire.log`、`pids.json`、`transcript.log`、`meta.json`。对照组覆盖同一目录，先把第一次的 after-kill.txt 与 server.log 提交再跑对照组，两次都提交。

验证点（`npm run check task4-stdio` 会查第一次）：

- after-kill.txt 含 not found，Server 已不存在。
- server.log 含 stdin-end。
- events.log 有 Server 的 exit 事件。

对照组应看到 server.log 有 stdin-end 但 after-kill.txt 里 Server 仍在，如实记录。

交的东西：`runs/<os>/task4-stdio/` 整个目录，两个 commit，message 写 task4-stdio 与 task4-stdio-noexit。
