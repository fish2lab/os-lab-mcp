# 任务 server：补全 server/fs-server.ts，检查器灌进去的 JSON-RPC 要得到正确的结果、错误与日志

目标：自己实现被驱动程序调用的那个进程，看清一次 tools/call 在 Server 里经过校验、open、日志三步。写完才能做任务 2 及之后的任务。

## 骨架给了什么，TODO 要补什么

`server/fs-server.ts` 已给：命令行解析 `parseCli`、日志函数 `logLine`、http 传输分支（SDK 无会话 transport 的样板）、启动流程。要补的地方标了 TODO，按编号：

- TODO 1：tools/list 处理函数，返回 read_file、list_dir、run_command 三个工具及其 inputSchema。
- TODO 2：tools/call 里的 read_file，`{path}`，返回文件文本。
- TODO 3：tools/call 里的 list_dir，`{path}`，返回每行一个名字。
- TODO 4：tools/call 里的 run_command，`{cmd, mode}`。mode 为 shell 时 `execFileSync("/bin/sh", ["-c", cmd])`，为 direct 时把 cmd 按空白切开后 `execFileSync(argv[0], argv.slice(1))`，返回 stdout 文本，日志行 `event=run_command mode=<mode> cmd=<cmd>`。这一项也可以留到任务 6 再写，但 `npm run check server` 要三个工具都在才全部通过。
- TODO 5：read_file 与 list_dir 调用前过 `allowed(path, root)`，root 取 `loadParams().root`；不通过就写 `event=deny` 日志并抛 `McpError(InvalidParams, "不允许读取 <path>")`。
- TODO 6：open 失败时写 `event=open-error ... errno=<名>` 日志，把 Node 的 err.message 原样放进错误 message（形如 `open failed: EPERM: ...`）；成功时写 `event=ok path=<path> bytes=<n>`。
- TODO 7：stdio 分支的 stdin 结束处理。默认 `process.stdin.on("end")` 时写 `event=stdin-end`、`event=exit` 并 `process.exit(0)`；`--no-exit-on-eof` 时仍写 stdin-end 但不退出，用 `setInterval(() => {}, 1000)` 保活。

每行日志的字段以 `docs/CONTRACT.md` §3 为准：start（含 ppid）、tools/call（含 id 与 name）、deny、open-error、ok、stdin-end、exit。检查器按这些行断言。

## 验收命令是 npm run check server，它灌八条报文并看日志

    npm run typecheck
    npm run check server

`check server` 以 stdio 启动你的 Server，依次发 initialize、notifications/initialized、tools/list、read_file 目标文件、read_file /etc/hosts、list_dir 白名单目录、run_command shell `echo hi`、run_command direct `echo hi`，再关 stdin；然后带 `--no-exit-on-eof` 再启动一次。断言：

- tools/list 含三个工具。
- 目标文件返回内容正确。
- /etc/hosts 返回 error 且 message 以「不允许读取」开头。
- list_dir 结果含 `<salt>.txt`。
- 两次 run_command 都返回 `hi`。
- 关 stdin 后 2 秒内退出码 0。
- server.log 有 start（含 ppid）、tools/call、deny、ok、stdin-end、exit 各至少一行。
- `--no-exit-on-eof` 时关 stdin 后 2 秒仍存活，且日志有 stdin-end。

手动试一条也可以：

    echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}' | OSLAB_OUT=/tmp/x node --experimental-strip-types server/fs-server.ts --transport stdio

输出应含 `"result"`。

交的东西：`server/fs-server.ts` 一个 commit，message 写 server。没有 runs/ 目录，报告里的证据是 `check server` 的输出与 server.log 行号。
