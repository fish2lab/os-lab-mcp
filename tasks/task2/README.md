# 任务 2：先写 tee/stdio-tee.ts，再跑 MCP stdio，看到 Server 是子进程、介质是 socket 对、open 发生在子进程

目标：看到驱动程序拉起 tee、tee 拉起 Server 的两次 exec，看到 Server 的 fd 0、1 是 unix socket。介质由 tee 建立，tee 由你写。

## 第 1 步是补全 tee/stdio-tee.ts，它在驱动程序与 Server 之间转发并记录每一行

骨架已给：参数解析（`--out DIR -- cmd args...`）、写 wire.log 的 `record(dir, line)`、用 `spawn` 启动 Server（stdin、stdout 为 pipe，stderr 继承）、启动后写 `DIR/pids.tee.json`。要补的地方标了 TODO，按编号：

- TODO 1：客户端 → Server。逐行读自己的 stdin，每行先 `record("c2s", line)`，再写到子进程 stdin（补回换行）。
- TODO 2：自己的 stdin 结束时只 `child.stdin.end()`，不 kill。
- TODO 3：Server → 客户端。逐行读子进程 stdout，每行先 `record("s2c", line)`，再写到自己的 stdout。
- TODO 4：子进程退出后以同一退出码退出；要等 stdout 读完再退，否则最后几行会丢。

`tee/http-tee.ts` 是成品，请求体与响应体各记一行的写法可以参照。验收：

    npm run typecheck
    npm run check task2

`check task2` 要跑完下面第 2 步才有文件可查。写完先一个 commit，message 写 stdio-tee。

## 第 2 步：在观测器下跑

命令（需要 sudo）：

    npm run observe -- stdio

驱动程序发 tools/call 前会暂停，打印 `OSLAB-EVENT pause server=<pid> tee=<pid>`。这时另开终端，macOS 跑 `lsof -p <Server pid>`，Linux 跑 `ls -l /proc/<Server pid>/fd`，输出粘进 `runs/<os>/task2/handles.txt`。再做对照组：`sleep 30 | cat &`，对 cat 的 pid 执行同一命令，也粘进 handles.txt。回到原终端按回车继续。

产物：`runs/<os>/task2/events.log`、`wire.log`、`handles.txt`（手工粘贴）、`ps.txt`、`pids.json`、`transcript.log`、`meta.json`，Linux 另有 `ipc.txt`。

验证点（`npm run check task2` 会查）：

- events.log 恰有两条 exec，第二条 argv 含 fs-server。macOS 每条 exec 前有 fork 事件，child 字段是新 pid。
- 目标文件 open 事件的 pid 等于 Server pid，不等于驱动程序 pid。
- ps.txt 里 Server 的 ppid 是 tee，tee 的 ppid 是驱动程序。
- wire.log 依次为 initialize、notifications/initialized、tools/list、tools/call，id 递增。
- handles.txt 存在，含 unix（Linux 为 socket:）和 PIPE（Linux 为 pipe:）。Linux 的 ipc.txt 有 socketpair(AF_UNIX, SOCK_STREAM, …)，没有 pipe2。

交的东西：`runs/<os>/task2/` 整个目录，一个 commit，message 写 task2。
