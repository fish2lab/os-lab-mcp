# 任务 4 HTTP：杀死驱动程序后 Server 仍在，因为它与驱动程序没有连接以外的关系

目标：与 task4-stdio 对照，看到 HTTP 下 Server 独立于驱动程序的生命周期。

前提：任务 3 终端 A 的 `npm run observe -- server-http` 还在跑，终端 B 的 `npm run tee:http` 还在跑。关掉了就按任务 3 的顺序重新起 A、B。

命令（需要 sudo）：

    npm run observe -- http --hang

驱动程序收到结果后打印 `OSLAB-EVENT hang driver=<pid> server=<pid>` 并保持 30 秒。30 秒内另开终端执行 `kill -9 <驱动程序 pid>`。脚本 5 秒后自动 `ps -p <Server pid>` 写 after-kill.txt。

产物：`runs/<os>/task4-http/after-kill.txt`、`events.log`、`wire.log`、`pids.json`、`transcript.log`、`meta.json`。Server 的日志仍写在 `runs/<os>/task3/server/server.log`。

验证点（`npm run check task4-http` 会查）：

- after-kill.txt 含 Server pid 那一行，Server 仍在。
- `runs/<os>/task3/server/server.log` 没有新增，行数与任务 3 结束时一致。

交的东西：`runs/<os>/task4-http/` 整个目录，一个 commit，message 写 task4-http。
