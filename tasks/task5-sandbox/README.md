# 任务 5 第 3 步：写一条沙箱规则，naive 校验放行，OS 层拒绝，open 发生但失败

目标：同一条白名单规则在内核态的痕迹，与第 2 步的应用层拒绝对照。

## 第 1 步：写规则

按系统改一个文件，诱饵目录写占位符 `__SECRET_DIR__`，observe.ts 运行前按 `.os-lab.json` 替换后写到 `runs/<os>/task5-sandbox/` 下再使用。

- macOS `observe/os-lab.sb`：已给 `(version 1)` 与 `(allow default)`，TODO 处加一条拒绝读 `__SECRET_DIR__` 子树的规则。写法见 `man sandbox-exec` 与 `/System/Library/Sandbox/Profiles/` 下的现成配置。
- Linux `observe/bwrap-args.txt`：已给 `--ro-bind / / --dev /dev --proc /proc --unshare-user --die-with-parent` 一行，TODO 处加一个用空文件系统盖住 `__SECRET_DIR__` 的挂载参数。`--ro-bind / /` 只挡写，见 `man bwrap`。

一个 commit，message 写 sandbox-rule。

## 第 2 步：跑

前提：第 2 步的 check.ts 修复已提交，工作树干净。脚本会把 `server/check.naive.ts` 复制到 `server/check.ts` 并断言为 naive 版，把 Server 放进沙箱（macOS `sandbox-exec -f`，Linux bwrap），结束后 `git checkout -- server/check.ts` 并再次断言。不要用 git stash：工作树干净时它什么都不做，第 3 次跑的仍会是 realpath 版。

命令（需要 sudo，路径与第 1 步相同）：

    npm run observe -- stdio --task task5-sandbox --sandbox --path "$HOME/os-lab/../os-lab-secret/flag.txt"

产物：`runs/<os>/task5-sandbox/wire.log`、`events.log`、`server.log`、替换后的 `os-lab.sb` 或 `bwrap-args.txt`、`pids.json`、`transcript.log`、`meta.json`，macOS 另有 `sandbox.log`（可以为空）。

验证点（`npm run check task5-sandbox` 会查，它也是沙箱规则的验收）：

- macOS：s2c 响应是 error，message 含 EPERM，events.log 有诱饵文件的 open 事件（Seatbelt 拒绝时 eslogger 仍收到通知）。sandbox.log 非空是额外证据，为空正常。
- Linux：s2c 响应是 error，message 含 ENOENT，路径在 Server 的挂载视图中不存在。WSL2 报 Failed to create new user namespace 时本步降为选做，报告中说明。

交的东西：`runs/<os>/task5-sandbox/` 整个目录，一个 commit，message 写 task5-sandbox。报告里说明第 2、3 次都返回错误，凭什么判断拒绝在不同层。
