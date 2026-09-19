# 这个仓库是《操作系统接口技术》验证实验的模板，学生跑命令、读日志、改一个文件

仓库里已有 Agent 驱动程序（pi 运行时加 MCP 桥）、MCP Filesystem Server、两种传输的报文记录器、按进程树过滤的观测脚本和验证脚本。学生按 `tasks/<任务名>/README.md` 跑九个任务，证据由脚本写进 `runs/<系统>/<任务名>/`，只手改 `server/check.ts` 一个源文件，最后填 `PREDICTION.md` 与 `REPORT.md`。任务的目标、验证点、记录表和思考题以 `实验指导书.html` 为准，命令细节以本仓库为准。全部任务调用 DeepSeek 的 `deepseek-v4-flash`，每人费用不超过 2 元。

## 快速开始有六步

1. 在课程模板仓库页面点 Use this template，建私有仓库，加助教为 collaborator。
2. 克隆到本机：`git clone <你的仓库地址> && cd <仓库目录>`。
3. `cp .env.example .env`，把 DeepSeek 密钥填进 `DEEPSEEK_API_KEY=`。密钥只放这个文件，不要 export 到 shell。
4. `npm install`。
5. `npm run doctor`。它检查工具、发一次最小模型请求并打印费用、按 GitHub 用户名派生个人参数、创建目标文件与诱饵文件、写 `.os-lab.json` 与 `DOCTOR.md`。macOS 需要先给终端程序开「完全磁盘访问」（系统设置，隐私与安全性），再重跑到 eslogger 一项通过。
6. `npm run task0`。终端分三色打印 tool_call JSON、JSON-RPC 报文、Server 返回内容。

课前还要做两件事：`npm run observe -- local --dry` 确认 `runs/` 下出现文件，然后填 `PREDICTION.md`，与 `DOCTOR.md` 一起提交。这个 commit 必须早于 `runs/` 的首次提交，评分脚本会核对顺序。

## 九个任务各跑什么命令、产物在哪、交什么

`<os>` 是 macos 或 linux，由脚本按系统决定。`$HOME/os-lab/../os-lab-secret/flag.txt` 是任务 5 固定的穿越路径。

| 任务 | 命令 | 产物目录 | 交的东西 |
|---|---|---|---|
| task0 | `npm run task0`，跑三次 | `runs/<os>/task0/` | transcript.log、meta.json |
| task1 | `npm run observe -- local` | `runs/<os>/task1/` | events.log、ps.txt、net.txt、transcript.log、meta.json |
| task2 | `npm run observe -- stdio`，暂停时另开终端拍 fd 快照 | `runs/<os>/task2/` | events.log、wire.log、handles.txt、ps.txt、pids.json、transcript.log、meta.json（Linux 另有 ipc.txt） |
| task3 | 终端 A `npm run observe -- server-http`，终端 B `npm run tee:http`，终端 C `npm run observe -- http` | `runs/<os>/task3/` 与 `runs/<os>/task3/server/` | 驱动侧 events.log、wire.log、net.txt、transcript.log；Server 侧 events.log、server.log |
| task4-stdio | `npm run observe -- stdio --hang`，30 秒内 `kill -9 <驱动程序 pid>` | `runs/<os>/task4-stdio/` | after-kill.txt、server.log、events.log |
| task4-http | 保持终端 A 的 Server，`npm run observe -- http --hang`，30 秒内 `kill -9 <驱动程序 pid>` | `runs/<os>/task4-http/` | after-kill.txt，对照 `runs/<os>/task3/server/server.log` |
| task5-naive | `npm run observe -- stdio --task task5-naive --path "$HOME/os-lab/../os-lab-secret/flag.txt"` | `runs/<os>/task5-naive/` | wire.log、events.log、server.log |
| task5-fixed | 改 `server/check.ts` 并单独 commit，再 `npm run observe -- stdio --task task5-fixed --path "$HOME/os-lab/../os-lab-secret/flag.txt"` | `runs/<os>/task5-fixed/` | wire.log、events.log、server.log、check.ts 的 diff |
| task5-sandbox | `npm run observe -- stdio --task task5-sandbox --sandbox --path "$HOME/os-lab/../os-lab-secret/flag.txt"` | `runs/<os>/task5-sandbox/` | wire.log、events.log、server.log、sandbox.log |

每个任务跑完执行 `npm run check <任务名>`，它把指导书的验证点写成断言，逐条打印 PASS 或 FAIL 并给出文件与行号。通过只说明文件自洽。验证点与实测不符时，把差异写进报告，属得分点。选做：`npm run observe -- stdio --hang --no-exit-on-eof`。

## 目录里每个路径是什么

| 路径 | 内容 |
|---|---|
| `server/fs-server.ts` | MCP Filesystem Server，`--transport stdio|http`。stdio 含 stdin EOF 退出约定，`--no-exit-on-eof` 关闭。HTTP 返回 JSON |
| `server/check.ts` | 路径校验，初始为 naive 版，含 TODO。任务 5 唯一要改的文件 |
| `server/check.naive.ts` | naive 版只读副本，脚本用，不要手改 |
| `driver/run.ts` | 驱动程序，`--mode local|stdio|http`，另有 `--hang`、`--path`、`--task`、`--dry`、`--sandbox` |
| `bridge/mcp-tool.ts` | 宿主进程内的 MCP 桥，把 tools/list 的结果翻译成模型可用的工具 |
| `tee/stdio-tee.ts`、`tee/http-tee.ts` | 两种传输的报文记录器，写 wire.log |
| `observe/observe.ts`、`observe/observe-macos.sh`、`observe/observe-linux.sh` | 观测脚本，起 eslogger 或 strace，按进程树过滤，写 events.log |
| `observe/os-lab.sb`、`observe/bwrap-args.txt` | 沙箱配置模板，脚本替换占位后使用 |
| `verify/salt.ts`、`verify/doctor.ts`、`verify/check-run.ts`、`verify/params.ts` | 个人参数派生、环境检查、验证点断言、参数读取 |
| `tasks/<任务名>/README.md` | 每个任务的精确命令与产物 |
| `docs/CONTRACT.md` | 各模块的接口与日志格式，读日志时查字段含义 |
| `AGENTS.md` | 给学生 agent 的规则 |
| `runs/<os>/<任务名>/` | 证据目录，纳入版本控制 |
| `PREDICTION.md`、`REPORT.md`、`DOCTOR.md` | 前两个学生填写，第三个 doctor 生成 |
| `.os-lab.json`、`.env` | 前者是 doctor 写的个人参数，提交；后者放密钥，已在 `.gitignore` |

## 提交方式是 Git 仓库加 tag submit

只交课程平台不交仓库者，机械分与分析分记 0。commit 顺序由评分脚本核对：

1. `PREDICTION.md` 与 `DOCTOR.md` 同一批，早于任何 `runs/` 提交。
2. task0 到 task3 每个任务一个 commit，message 写任务名。
3. task4-stdio、task4-http 各一个 commit。
4. task5-naive 一个 commit。
5. `server/check.ts` 的修复单独一个 commit。
6. task5-fixed、task5-sandbox 各一个 commit。
7. `REPORT.md` 提交后打 tag：`git tag submit && git push origin submit`。

`runs/` 里的文件由脚本生成，原样提交，不手改。向任课教师当面汇报约 3 分钟，两问均从本人 salt 目录的日志中抽。
