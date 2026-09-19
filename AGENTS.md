# 学生的编程 agent 在这个仓库里能跑哪些命令、不能改哪些文件

这个仓库是《操作系统接口技术》的验证实验模板。学生的 agent 可以跑命令、读日志、解释日志字段、帮学生定位行号。预测、记录表、思考题和报告里的判断由学生本人写，agent 不代写。任务说明在 `tasks/<任务名>/README.md`，日志格式在 `docs/CONTRACT.md`。

## 允许跑的命令只有下面这些

| 命令 | 用途 |
|---|---|
| `npm install` | 装依赖 |
| `npm run doctor` | 环境检查、派生个人参数、创建目标文件与诱饵文件 |
| `npm run task0` | 任务 0，不经观测器 |
| `npm run observe -- local` | 任务 1 |
| `npm run observe -- local --dry` | 课前确认 `runs/` 出现文件，不调模型 |
| `npm run observe -- stdio` | 任务 2 |
| `npm run observe -- server-http`、`npm run tee:http`、`npm run observe -- http` | 任务 3，三个终端 |
| `npm run observe -- stdio --hang`、`npm run observe -- http --hang` | 任务 4 |
| `npm run observe -- stdio --hang --no-exit-on-eof` | 任务 4 选做 |
| `npm run observe -- stdio --task task5-naive --path "$HOME/os-lab/../os-lab-secret/flag.txt"` | 任务 5 第 1 步 |
| `npm run observe -- stdio --task task5-fixed --path "$HOME/os-lab/../os-lab-secret/flag.txt"` | 任务 5 第 2 步 |
| `npm run observe -- stdio --task task5-sandbox --sandbox --path "$HOME/os-lab/../os-lab-secret/flag.txt"` | 任务 5 第 3 步 |
| `npm run check <任务名>` | 把验证点写成断言，给出行号 |
| `npm run typecheck` | 改完 `server/check.ts` 后做类型检查 |
| `git add`、`git commit`、`git tag submit`、`git push` | 提交。commit 顺序见 `README.md` |
| `lsof -p <pid>`、`ls -l /proc/<pid>/fd`、`ps -o pid,ppid,command -p <pid>`、`kill -9 <驱动程序 pid>` | 任务 2、3、4 的手动步骤，pid 从驱动程序打印的 `OSLAB-EVENT` 行取 |

观测脚本需要 sudo（macOS 跑 eslogger，Linux 跑 strace），密码由学生本人输入。agent 不改 sudoers，不用 `sudo -S` 传密码。`--path` 的穿越目标仅限 doctor 在本人家目录创建的诱饵文件，不用于其他路径或他人机器。

## 受保护的文件不改，学生只改 server/check.ts 与两份报告

下列路径由课程提供，任何修改都会让 `npm run check` 与评分脚本失效，agent 不改、不重排、不格式化：

- `server/fs-server.ts`、`server/check.naive.ts`
- `observe/**`、`verify/**`、`driver/**`、`bridge/**`、`tee/**`
- `package.json`、`package-lock.json`、`tsconfig.json`、`docs/CONTRACT.md`、`tasks/**`

学生能改的文件有四类：`server/check.ts`（任务 5 第 2 步，修改单独一个 commit）、`PREDICTION.md`、`REPORT.md`、`runs/**` 里由学生手工粘贴的 `handles.txt`。`server/check.ts` 的修复方向是对 path 与 root 分别 `fs.realpathSync`，比较前缀，前缀后须为路径分隔符或字符串结束，参考实现 6 到 10 行。agent 可以解释这个漏洞，改动由学生自己写并理解，当面汇报会问到。

## 密钥只在 .env，不 export、不写进代码、不 commit

`DEEPSEEK_API_KEY` 只存在于仓库根目录 `.env`（已在 `.gitignore`）。agent 不把它写进任何 `.ts`、`.json`、`.md` 或 shell 配置，不 `export` 到当前 shell，不在命令行里以 `KEY=... npm run` 的形式传入，不打印到终端或日志。原因：exec 事件带完整环境变量，`runs/` 要提交；doctor 与驱动程序发现 shell 环境里已有该变量时会拒绝运行。agent 读 `.env` 只为确认文件存在，不复述内容。

## runs/ 由脚本生成，原样提交，不手改

`runs/<os>/<任务名>/` 下的 `events.log`、`wire.log`、`server.log`、`transcript.log`、`ps.txt`、`net.txt`、`after-kill.txt`、`meta.json`、`pids.json` 全部由脚本写入，评分脚本核对它们之间的 pid 与请求 id 对应关系。agent 不编辑、不删行、不补行、不重新生成后替换。一次运行结果异常就再跑一次，两次都提交。唯一手写的文件是任务 2 的 `handles.txt`，内容是 `lsof` 或 `ls -l /proc/<pid>/fd` 的原样输出。

## agent 帮读日志，判断由学生写

agent 可以做的：解释 `events.log` 某一行是什么事件、哪个 pid、由谁 fork；解释 `wire.log` 某条 JSON-RPC 报文的方法与 id；把 `npm run check` 的 FAIL 对应到文件行号；指出 `docs/CONTRACT.md` 里某个字段的含义。

agent 不做的：填 `PREDICTION.md` 的预测值；填 `REPORT.md` 的记录表、思考题与总结；替学生解释预测与实测的差异。评分中的分析分、预测分与当面汇报分共 60 分，全部要求引用本人日志的文件名与行号，通用答案不得分。
