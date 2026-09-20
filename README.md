# 这个仓库是《操作系统接口技术》验证实验的模板，学生写四个文件、跑命令、读日志

仓库里已有 Agent 驱动程序（pi 运行时加 MCP 桥）、HTTP 报文记录器、按进程树过滤的观测脚本和检查器。学生补写四个文件：`server/fs-server.ts` 的工具处理、`tee/stdio-tee.ts` 的转发、`server/check.ts` 的 realpath 校验、`observe/os-lab.sb` 或 `observe/bwrap-args.txt` 的一条沙箱规则。其余按 `tasks/<任务名>/README.md` 跑命令，证据由脚本写进 `runs/<系统>/<任务名>/`，每个任务用 `npm run check <任务名>` 验收，最后写 `PREDICTION.md` 与 `REPORT.md`。任务的目标、验证点和思考题以 `实验指导书.html` 为准，命令细节以本仓库为准。全部任务调用 DeepSeek 的 `deepseek-v4-flash`，每人费用不超过 2 元。

## 快速开始有六步

1. 在课程模板仓库页面点 Use this template，建私有仓库，加助教为 collaborator。
2. 克隆到本机：`git clone <你的仓库地址> && cd <仓库目录>`。
3. `cp .env.example .env`，把 DeepSeek 密钥填进 `DEEPSEEK_API_KEY=`。密钥只放这个文件，不要 export 到 shell。
4. `npm install`。
5. `npm run doctor`。它检查工具、发一次最小模型请求并打印费用、按 GitHub 用户名派生个人参数、创建目标文件与诱饵文件、写 `.os-lab.json` 与 `DOCTOR.md`。macOS 需要先给终端程序开「完全磁盘访问」（系统设置，隐私与安全性），再重跑到 eslogger 一项通过。
6. `npm run task0`。local 模式，不需要 Server，终端打印 tool_call JSON 与工具返回内容。

课前还要做两件事：`npm run observe -- local --dry` 确认 `runs/` 下出现文件，然后填 `PREDICTION.md` 的四项预测，与 `DOCTOR.md` 一起提交。这个 commit 必须早于 `runs/<os>/task2/` 的首次提交，评分脚本会核对顺序。

## 十一项任务各跑什么命令、写什么、用什么验收

`<os>` 是 macos 或 linux，由脚本按系统决定。`$HOME/os-lab/../os-lab-secret/flag.txt` 是任务 5 固定的穿越路径。

| 任务 | 命令 | 学生写 | 验收 | 产物目录 |
|---|---|---|---|---|
| task0 | `npm run task0`，跑三次（local 模式） | 无 | `npm run check task0` | `runs/<os>/task0/` |
| task1 | `npm run observe -- local` | 无 | `npm run check task1` | `runs/<os>/task1/` |
| server | 写 `server/fs-server.ts` | tools/list 与 tools/call 处理（read_file、list_dir、run_command）、校验与 deny 日志、errno 记录、stdin 结束处理 | `npm run check server` | 无，check 输出即证据 |
| task2 | 写 `tee/stdio-tee.ts`，再 `npm run observe -- stdio`，暂停时另开终端拍 fd 快照 | spawn Server、双向逐行转发、stdin 结束只关 Server 的 stdin、同码退出 | `npm run check task2` | `runs/<os>/task2/` |
| task3 | 终端 A `npm run observe -- server-http`，终端 B `npm run tee:http`，终端 C `npm run observe -- http` | 无（http 分支已给） | `npm run check task3` | `runs/<os>/task3/` 与 `runs/<os>/task3/server/` |
| task4-stdio | `npm run observe -- stdio --hang`，30 秒内 `kill -9 <驱动程序 pid>`；再加 `--no-exit-on-eof` 跑一次对照 | 无 | `npm run check task4-stdio` | `runs/<os>/task4-stdio/` |
| task4-http | 保持终端 A 的 Server，`npm run observe -- http --hang`，30 秒内 `kill -9 <驱动程序 pid>` | 无 | `npm run check task4-http` | `runs/<os>/task4-http/` |
| task5-naive | `npm run observe -- stdio --task task5-naive --path "$HOME/os-lab/../os-lab-secret/flag.txt"` | 无 | `npm run check task5-naive` | `runs/<os>/task5-naive/` |
| task5-fixed | 改 `server/check.ts` 并单独 commit，再 `npm run observe -- stdio --task task5-fixed --path "$HOME/os-lab/../os-lab-secret/flag.txt"` | realpath 校验 | `npm run check task5-fixed` | `runs/<os>/task5-fixed/` |
| task5-sandbox | 写沙箱规则并 commit，再 `npm run observe -- stdio --task task5-sandbox --sandbox --path "$HOME/os-lab/../os-lab-secret/flag.txt"` | `observe/os-lab.sb` 一条 deny 规则，或 `observe/bwrap-args.txt` 一个挂载参数 | `npm run check task5-sandbox` | `runs/<os>/task5-sandbox/` |
| task6-shell | `npm run observe -- stdio --task task6-shell` | run_command 工具（server 一项未写则在此补） | `npm run check task6-shell` | `runs/<os>/task6-shell/` |

`npm run check <任务名>` 把指导书的验证点写成断言，逐条打印 PASS 或 FAIL 并给出文件与行号。通过只说明文件自洽。验证点与实测不符时，把差异写进报告，属得分点。提交前十一项 check 全部通过。

## 目录里每个路径是什么

| 路径 | 内容 |
|---|---|
| `server/fs-server.ts`（学生写） | MCP Filesystem Server 骨架，`--transport stdio|http`。已给命令行解析、`logLine`、http 分支、启动流程；学生补 TODO 处 |
| `server/check.ts`（学生写） | 路径校验，初始为 naive 版，含 TODO。任务 5 第 2 步改为 realpath 版 |
| `server/check.naive.ts` | naive 版只读副本，脚本用，不要手改 |
| `driver/run.ts` | 驱动程序，`--mode local|stdio|http`，另有 `--hang`、`--path`、`--task`、`--dry`、`--sandbox` |
| `bridge/mcp-tool.ts` | 宿主进程内的 MCP 桥，把 tools/list 的结果翻译成模型可用的工具 |
| `tee/stdio-tee.ts`（学生写） | stdio 报文记录器骨架。已给参数解析、写 wire.log 的 `record()`、写 pids.tee.json；学生补 TODO 处 |
| `tee/http-tee.ts` | HTTP 报文记录器，成品，写 stdio-tee 时参照 |
| `observe/observe.ts`、`observe/observe-macos.sh`、`observe/observe-linux.sh` | 观测脚本，起 eslogger 或 strace，按进程树过滤，写 events.log |
| `observe/os-lab.sb`、`observe/bwrap-args.txt`（学生写，按系统选一个） | 沙箱配置模板，诱饵目录写 `__SECRET_DIR__`，脚本替换占位后使用 |
| `verify/salt.ts`、`verify/doctor.ts`、`verify/params.ts` | 个人参数派生、环境检查、参数读取 |
| `verify/check-run.ts`、`verify/check-server.ts` | 各任务验证点断言；用 stdin 灌 JSON-RPC 验收学生的 Server |
| `tasks/<任务名>/README.md` | 每个任务的精确命令、TODO 清单与验收命令 |
| `docs/CONTRACT.md` | 各模块的接口与日志格式，写 Server 与读日志时查字段含义 |
| `AGENTS.md` | 给学生 agent 的规则 |
| `runs/<os>/<任务名>/` | 证据目录，纳入版本控制 |
| `PREDICTION.md`、`REPORT.md`、`DOCTOR.md` | 前两个学生填写，第三个 doctor 生成 |
| `.os-lab.json`、`.env` | 前者是 doctor 写的个人参数，提交；后者放密钥，已在 `.gitignore` |

## 提交方式是 Git 仓库加 tag submit

只交课程平台不交仓库者，机械分与叙述分记 0。commit 顺序由评分脚本核对：

1. `PREDICTION.md` 与 `DOCTOR.md` 同一批，早于 `runs/<os>/task2/` 的提交。
2. task0、task1 各一个 commit，message 写任务名。
3. `server/fs-server.ts` 一个 commit，message 写 server。
4. `tee/stdio-tee.ts` 一个 commit，message 写 stdio-tee；task2、task3 各一个 commit。
5. task4-stdio、task4-http 各一个 commit。
6. task5-naive 一个 commit。
7. `server/check.ts` 的修复单独一个 commit。
8. task5-fixed 一个 commit；沙箱规则一个 commit；task5-sandbox 一个 commit。
9. task6-shell 一个 commit。
10. 十一项 `npm run check` 全部通过，`REPORT.md` 提交后打 tag：`git tag submit && git push origin submit`。

`runs/` 里的文件由脚本生成，原样提交，不手改。向任课教师当面汇报约 3 分钟，问题从本人 runs/ 与自己写的四个文件里抽。
