# 任务 5 第 2 步：改 server/check.ts 为 realpath 校验，Server 在应用层拒绝

目标：修复用户态漏洞，看到拒绝发生在校验函数，open 没有发生。

先改 `server/check.ts`：对 path 与 root 分别 `fs.realpathSync`，比较前缀，前缀后须为路径分隔符或字符串结束。参考实现 6 到 10 行。`npm run typecheck` 通过后单独一个 commit，message 里写 check.ts。不改 `server/check.naive.ts`。

命令（需要 sudo，路径与第 1 步相同）：

    npm run observe -- stdio --task task5-fixed --path "$HOME/os-lab/../os-lab-secret/flag.txt"

产物：`runs/<os>/task5-fixed/wire.log`、`events.log`、`server.log`、`pids.json`、`transcript.log`、`meta.json`。

验证点（`npm run check task5-fixed` 会查）：

- wire.log 的 s2c 响应是 JSON-RPC error，message 含「不允许读取」。
- events.log 没有诱饵文件的 open 事件。

交的东西：check.ts 修复一个 commit，`runs/<os>/task5-fixed/` 整个目录另一个 commit，message 写 task5-fixed。`npm run check task5-fixed` 是 check.ts 的验收。报告里贴 `git show <commit> -- server/check.ts` 的 diff。

评分脚本还会单独调用你的 `allowed()`：目标文件要返回 true；`<root>/../os-lab-secret/flag.txt`、白名单目录里指向诱饵文件的符号链接、同前缀的兄弟目录 `~/os-lab-evil/x.txt`、不存在的文件都要返回 false。realpath 版天然满足，前缀比较后补一个分隔符的版本过不了符号链接那条。
