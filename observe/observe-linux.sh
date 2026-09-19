#!/usr/bin/env bash
# Linux（WSL2 / Ubuntu）观测脚本（由 observe.ts 调用，学生一般不直接运行）。
# 在实验里的角色：用 strace -f 跟踪 driver 及其全部子进程的进程、IPC、网络、文件类系统调用，
# 原始输出写到 DIR/raw.strace，过滤由 observe.ts 完成。用法：observe-linux.sh <DIR> <mode> -- <driver 命令...>
# 不要加 -v：加了 execve 行会展开环境变量（含 API 密钥）。
set -u
set -o pipefail

DIR="$1"; MODE="$2"; shift 2
if [ "${1:-}" != "--" ]; then echo "用法：observe-linux.sh <DIR> <mode> -- <driver 命令...>" >&2; exit 2; fi
shift

if ! command -v strace > /dev/null; then
  echo "缺少 strace：sudo apt install strace 后重试" >&2
  exit 3
fi

mkdir -p "$DIR"
trap 'true' INT
echo "OSLAB-OBSERVE 开始 mode=$MODE dir=$DIR" >&2
strace -f -ttt -o "$DIR/raw.strace" -e trace=process,ipc,network,file,desc "$@" | tee "$DIR/driver.out"
RC=${PIPESTATUS[0]}
trap - INT
echo "OSLAB-OBSERVE 结束 exit=$RC raw=$(wc -l < "$DIR/raw.strace" | tr -d ' ') 行" >&2
exit "$RC"
