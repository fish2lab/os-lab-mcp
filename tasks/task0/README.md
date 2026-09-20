# 任务 0：跑三次 npm run task0，看模型输出什么、宿主替它做什么

目标：看清模型只输出工具名与路径参数，读文件由驱动程序进程内的工具函数完成。此时 Server 还没写，用 local 模式。

命令（跑三次，每次结束后比较终端里的 tool_call 参数）：

    npm run task0

它把指令「读取 ~/os-lab/<salt>.txt 并原样返回其内容」发给模型，驱动程序在本进程执行 read_file，终端打印 tool_call JSON（黄）与工具返回内容（绿），末尾打印 token 数与费用。不经观测器，不需要 sudo。

产物：`runs/<os>/task0/transcript.log`（三次运行的 model、tool、summary 记录）、`meta.json`。

验证点（`npm run check task0` 会查）：

- transcript.log 里三条 model 记录的 `toolCalls[0].name` 都是 read_file。
- 三条记录的 path 参数指向同一个 realpath。`~` 是否展开属正常差异，记进报告。

交的东西：`runs/<os>/task0/` 整个目录，一个 commit，message 写 task0。
