#!/usr/bin/env bash
# macOS 观测脚本（由 observe.ts 调用，学生一般不直接运行）。
# 在实验里的角色：用 eslogger 订阅内核的 fork/exec/open/exit 事件，把 driver、tee、Server 这一棵进程树
# 在运行期间的系统行为录下来。用法：observe-macos.sh <DIR> <mode> -- <driver 命令...>
# 要点：eslogger 必须用 setsid 起在独立会话，否则它会抑制同进程组的事件；driver 退出后再停 eslogger。
set -u
set -o pipefail

DIR="$1"; MODE="$2"; shift 2
if [ "${1:-}" != "--" ]; then echo "用法：observe-macos.sh <DIR> <mode> -- <driver 命令...>" >&2; exit 2; fi
shift

if ! sudo -v; then
  echo "需要 sudo：先运行 sudo -v 再重试" >&2
  exit 3
fi

mkdir -p "$DIR"
: > "$DIR/raw.eslogger"

# 独立会话里启动 eslogger，原始输出直接落盘（raw.* 已在 .gitignore，里面含环境变量，不要提交）。
# macOS 没有 setsid 命令，用 perl 的 POSIX::setsid 起独立会话
sudo perl -e 'use POSIX qw(setsid); setsid(); exec @ARGV or die "exec eslogger 失败: $!"' -- eslogger fork exec open exit > "$DIR/raw.eslogger" 2> "$DIR/eslogger.err" &
ESLOGGER_JOB=$!
sleep 1
if ! sudo pgrep -x eslogger > /dev/null; then
  echo "eslogger 没有启动成功，看 $DIR/eslogger.err（常见原因：终端程序没有完全磁盘访问权限）" >&2
  exit 4
fi

# Ctrl-C 只发给前台的 driver / Server，本脚本继续执行后面的收尾。
trap 'true' INT

echo "OSLAB-OBSERVE 开始 mode=$MODE dir=$DIR" >&2
# driver 的 stdout 同时回显（供 observe.ts 逐行读 OSLAB-EVENT）并存到 driver.out。
"$@" | tee "$DIR/driver.out"
RC=${PIPESTATUS[0]}
trap - INT

# 停止 eslogger，等它把缓冲写完再退出。
sudo pkill -f eslogger 2>/dev/null || true
for _ in 1 2 3 4 5 6 7 8 9 10; do
  sudo pgrep -x eslogger > /dev/null || break
  sleep 0.5
done
wait "$ESLOGGER_JOB" 2>/dev/null || true
sleep 0.5

echo "OSLAB-OBSERVE 结束 exit=$RC raw=$(wc -l < "$DIR/raw.eslogger" | tr -d ' ') 行" >&2
exit "$RC"
