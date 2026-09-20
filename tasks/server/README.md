# 任务 server：补全 server/fs-server.ts，检查器灌进去的 JSON-RPC 要得到正确的结果、错误与日志

目标：自己实现被驱动程序调用的那个进程，看清一次 tools/call 在 Server 里经过校验、open、日志三步。写完才能做任务 2 及之后的任务。

## 骨架给了什么，TODO 要补什么

`server/fs-server.ts` 已给：命令行解析 `parseCli`、日志函数 `logLine`、`mcpError` / `errnoOf` / `textResult` 三个小工具、tools/list 的工具表（read_file、list_dir、run_command 及 inputSchema）、tools/call 的分发、http 传输分支（SDK 无会话 transport 的样板）、启动流程。要补的地方标了 TODO，按编号：

- TODO 1：`checkOrDeny(path, root)`。`allowed(path, root)` 不通过就写 `event=deny path=<path>` 日志并抛 `mcpError(InvalidParams, "不允许读取 <path>")`；通过则什么都不做。
- TODO 2：`readFileTool`。先 checkOrDeny，再 `readFileSync(path, "utf8")`。读失败写 `event=open-error path=<path> errno=<名>` 并抛 `mcpError(InternalError, "open failed: " + err.message)`；成功写 `event=ok path=<path> bytes=<n>`，返回 `textResult(text)`。
- TODO 3：`listDirTool`。同 read_file，只是用 `readdirSync`，返回的文本是名字按行拼接。
- TODO 4：`runCommandTool(cmd, mode)`。写 `event=run_command mode=<mode> cmd=<cmd>`；mode 为 shell 时 `execFileSync("/bin/sh", ["-c", cmd])`，为 direct 时把 cmd 按空白切开后 `execFileSync(argv[0], argv.slice(1))`，返回 stdout 文本。不做路径校验。这一项也可以留到任务 6 再写，但 `npm run check server` 要三个工具都能用才全部通过。
- TODO 5：stdio 分支的 stdin 结束处理。`process.stdin.on("end")` 时写 `event=stdin-end`；默认 `process.exit(0)`（exit 钩子会写 `event=exit`）；`--no-exit-on-eof` 时不退出，用 `setInterval(() => {}, 1000)` 保活。

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
