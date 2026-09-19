// TODO(任务 5 第 2 步)：把下面的前缀比较改成 realpath 后比较，前缀后必须紧跟路径分隔符。
export function allowed(path: string, root: string): boolean {
  return path.startsWith(root + "/");
}
