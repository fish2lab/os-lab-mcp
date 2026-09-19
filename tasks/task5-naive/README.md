# 任务 5 第 1 步：naive 前缀校验放过穿越路径，Server 读出诱饵内容

目标：看到 `path.startsWith(root + "/")` 对 `$HOME/os-lab/../os-lab-secret/flag.txt` 返回 true，open 在 Server 进程发生并成功。前提：`server/check.ts` 仍是初始版（含 TODO，与 `server/check.naive.ts` 相同）。穿越目标仅限 doctor 在本人家目录创建的诱饵文件。

命令（需要 sudo）：

    npm run observe -- stdio --task task5-naive --path "$HOME/os-lab/../os-lab-secret/flag.txt"

驱动程序在本任务温度设 0，系统提示要求路径与用户给出的完全一致。模型改写或拒绝时重试至多三次并记录每次 tool_call，三次都改写则用最后一次路径继续并在 transcript.log 里标记 note。

产物：`runs/<os>/task5-naive/wire.log`、`events.log`、`server.log`、`pids.json`、`transcript.log`、`meta.json`。

验证点（`npm run check task5-naive` 会查）：

- wire.log 的 s2c 响应含 `FLAG{`。
- events.log 有诱饵文件的 open 事件，pid 等于 Server pid。

交的东西：`runs/<os>/task5-naive/` 整个目录，一个 commit，message 写 task5-naive。
