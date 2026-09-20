# bwrap-args.txt（Linux / WSL2 的任务 5 第 3 步）

这一行是 bubblewrap 的参数，observe.ts 运行前把 `__SECRET_DIR__` 换成诱饵目录，driver 用 `bwrap <这些参数> -- node server/fs-server.ts ...` 启动 Server。

已给：整个根文件系统只读绑定、/dev 与 /proc、用户命名空间、随父进程退出。要补：一个参数，让 Server 看不到 `__SECRET_DIR__` 里的文件（提示：用一个空的 tmpfs 盖住它，`man bwrap` 里找 `--tmpfs`）。补完后 Server 读诱饵会得到 ENOENT，与 macOS 的 EPERM 对照。
