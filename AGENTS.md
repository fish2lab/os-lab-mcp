# 学生的编程 agent 在这个仓库里能跑哪些命令、能改哪些文件

这个仓库是《操作系统接口技术》的验证实验模板。学生的 agent 可以跑命令、读日志、解释日志字段、帮学生定位行号，也可以帮学生写下面列出的五个文件。报告的叙述与口试答的是学生自己的日志，agent 不代写报告。任务说明在 `tasks/<任务名>/README.md`，接口与日志格式在 `docs/CONTRACT.md`。

## 允许跑的命令只有下面这些

| 命令 | 用途 |
|---|---|
| `npm install` | 装依赖 |
| `npm run doctor` | 环境检查、派生个人参数、创建目标文件与诱饵文件 |
| `npm run task0` | 任务 0，local 模式，不经观测器 |
| `npm run observe -- local` | 任务 1 |
| `npm run observe -- local --dry` | 课前确认 `runs/` 出现文件，不调模型 |
| `npm run check server` | server 任务的验收，用 stdin 灌 JSON-RPC |
| `npm run observe -- stdio` | 任务 2 |
| `npm run observe -- server-http`、`npm run tee:http`、`npm run observe -- http` | 任务 3，三个终端 |
| `npm run observe -- stdio --hang`、`npm run observe -- stdio --hang --no-exit-on-eof`、`npm run observe -- http --hang` | 任务 4 |
| `npm run observe -- stdio --task task5-naive --path "$HOME/os-lab/../os-lab-secret/flag.txt"` | 任务 5 第 1 步 |
| `npm run observe -- stdio --task task5-fixed --path "$HOME/os-lab/../os-lab-secret/flag.txt"` | 任务 5 第 2 步 |
| `npm run observe -- stdio --task task5-sandbox --sandbox --path "$HOME/os-lab/../os-lab-secret/flag.txt"` | 任务 5 第 3 步 |
| `npm run observe -- stdio --task task6-shell` | 任务 6 |
| `npm run check <任务名>` | 把验证点写成断言，给出行号 |
| `npm run typecheck` | 改完任何 `.ts` 后做类型检查 |
| `git add`、`git commit`、`git tag submit`、`git push` | 提交。commit 顺序见 `README.md` |
| `lsof -p <pid>`、`ls -l /proc/<pid>/fd`、`ps -o pid,ppid,command -p <pid>`、`kill -9 <驱动程序 pid>` | 任务 2、3、4 的手动步骤，pid 从驱动程序打印的 `OSLAB-EVENT` 行取 |

观测脚本需要 sudo（macOS 跑 eslogger，Linux 跑 strace），密码由学生本人输入。agent 不改 sudoers，不用 `sudo -S` 传密码。`--path` 的穿越目标仅限 doctor 在本人家目录创建的诱饵文件，不用于其他路径或他人机器。

## 学生只改五个文件和报告，其余受保护

学生能改的文件：`server/fs-server.ts`、`tee/stdio-tee.ts`、`server/check.ts`、`observe/os-lab.sb`、`observe/bwrap-args.txt`，以及 `PREDICTION.md`、`REPORT.md` 和 `runs/**` 里由学生手工粘贴的 `handles.txt`。agent 可以帮学生写这五个文件，但报告的叙述与口试答的是学生自己的日志，口试会抽这五个文件里的一处问为什么这样写。

下列路径由课程提供，任何修改都会让 `npm run check` 与评分脚本失效，agent 不改、不重排、不格式化：

- `server/check.naive.ts`
- `driver/**`、`bridge/**`、`tee/http-tee.ts`、`observe/*.ts`、`observe/*.sh`、`verify/**`
- `package.json`、`package-lock.json`、`tsconfig.json`、`docs/CONTRACT.md`、`tasks/**`

写这五个文件时的边界：`fs-server.ts` 只补 TODO 处，已给的命令行解析、`logLine`、http 分支不改；日志行格式按 `docs/CONTRACT.md` §3，检查器按它断言。`stdio-tee.ts` 的 stdin 结束时只关 Server 的 stdin，不 kill。`check.ts` 的修复单独一个 commit。沙箱文件里诱饵目录写 `__SECRET_DIR__`，不写真实路径。

## 密钥只在 .env，不 export、不写进代码、不 commit

`DEEPSEEK_API_KEY` 只存在于仓库根目录 `.env`（已在 `.gitignore`）。agent 不把它写进任何 `.ts`、`.json`、`.md` 或 shell 配置，不 `export` 到当前 shell，不在命令行里以 `KEY=... npm run` 的形式传入，不打印到终端或日志。原因：exec 事件带完整环境变量，`runs/` 要提交；doctor 与驱动程序发现 shell 环境里已有该变量时会拒绝运行。agent 读 `.env` 只为确认文件存在，不复述内容。

## runs/ 由脚本生成，原样提交，不手改

`runs/<os>/<任务名>/` 下的 `events.log`、`wire.log`、`server.log`、`transcript.log`、`ps.txt`、`net.txt`、`after-kill.txt`、`meta.json`、`pids.json` 全部由脚本写入，评分脚本核对它们之间的 pid 与请求 id 对应关系。agent 不编辑、不删行、不补行、不重新生成后替换。一次运行结果异常就再跑一次，两次都提交。唯一手写的文件是任务 2 的 `handles.txt`，内容是 `lsof` 或 `ls -l /proc/<pid>/fd` 的原样输出。

## agent 帮读日志和写代码，叙述由学生写

agent 可以做的：解释 `events.log` 某一行是什么事件、哪个 pid、由谁 fork；解释 `wire.log` 某条 JSON-RPC 报文的方法与 id；把 `npm run check` 的 FAIL 对应到文件行号或代码行；指出 `docs/CONTRACT.md` 里某个字段的含义；帮写上面五个文件。

agent 不做的：填 `PREDICTION.md` 的预测；写 `REPORT.md` 每个任务的叙述段、思考题与总结；替学生解释预测与实测的差异。叙述分、预测分与口试分共 60 分，全部要求引用本人日志的文件名与行号，通用答案不得分。
