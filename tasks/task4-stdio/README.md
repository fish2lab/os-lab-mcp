# 任务 4 stdio：杀死驱动程序后 Server 退出，退出来自 stdin EOF 的代码约定

目标：区分退出行为中来自介质的部分与来自代码约定的部分。Server 在 stdio 模式下有约定 `process.stdin.on("end", () => process.exit(0))`，tee 读到 EOF 时关闭 Server 的 stdin。

命令（需要 sudo）：

    npm run observe -- stdio --hang

驱动程序收到结果后打印 `OSLAB-EVENT hang driver=<pid> server=<pid>` 并保持 30 秒。30 秒内另开终端执行 `kill -9 <驱动程序 pid>`。脚本 5 秒后自动 `ps -p <Server pid>` 写 after-kill.txt。

选做（去掉约定并挂一个空定时器，结果如实记录）：

    npm run observe -- stdio --hang --no-exit-on-eof

产物：`runs/<os>/task4-stdio/after-kill.txt`、`server.log`、`events.log`、`wire.log`、`pids.json`、`transcript.log`、`meta.json`。

验证点（`npm run check task4-stdio` 会查）：

- after-kill.txt 含 not found，Server 已不存在。
- server.log 含 stdin-end。
- events.log 有 Server 的 exit 事件。

交的东西：`runs/<os>/task4-stdio/` 整个目录，一个 commit，message 写 task4-stdio。选做的结果写进报告。
