// 环境体检。做实验前先跑一次：node --experimental-strip-types verify/doctor.ts（即 npm run doctor）。
//
// 它做三件事：
//   1. 逐项检查本机条件（Node 版本、git、GitHub 用户名、观测工具、sudo、密钥放置、模型能否调通、完全磁盘访问）。
//   2. 按你的 GitHub 用户名推导个人参数（verify/salt.ts），创建 target 与 decoy 文件，写仓库根 .os-lab.json。
//   3. 把每项结果写成 DOCTOR.md 表格并打印。
//
// 有任何一项「未通过」时退出码为 1；「未验证」表示本机没法自动确认，需要你按说明手动确认。
// 密钥只从 .env 读，绝不打印；若发现 shell 环境里已经有 DEEPSEEK_API_KEY，会直接报错退出，见下方解释。
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createModels } from "@earendil-works/pi-ai";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { loadEnv, osName, repoRoot, type Params } from "./params.ts";
import { derive } from "./salt.ts";

type Verdict = "通过" | "未通过" | "未验证";
interface Row { item: string; verdict: Verdict; note: string }
const rows: Row[] = [];

function record(item: string, verdict: Verdict, note: string): void {
  rows.push({ item, verdict, note });
  console.log(`[${verdict}] ${item}：${note}`);
}

/** 跑一条命令，返回 stdout（去掉首尾空白）；失败返回 null。永远不走交互。 */
function run(cmd: string, args: string[], timeoutMs = 10_000): string | null {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: timeoutMs }).trim();
  } catch {
    return null;
  }
}

/** 命令是否在 PATH 里。 */
function which(cmd: string): string | null {
  return run("/bin/sh", ["-c", `command -v ${cmd}`]);
}

/** 把密钥从任何要打印的文本里抹掉，防止错误信息带出密钥。 */
function scrub(text: string, secret: string | undefined): string {
  if (!secret) return text;
  return text.split(secret).join("<已隐藏>");
}

// ---------- 1. 基础工具 ----------

function checkNode(): void {
  const v = process.versions.node;
  const [major, minor] = v.split(".").map(Number);
  const ok = major > 22 || (major === 22 && minor >= 6);
  record("Node 版本 ≥ 22.6", ok ? "通过" : "未通过", `当前 v${v}${ok ? "" : "，请升级 Node"}`);
}

function checkGit(): void {
  const v = run("git", ["--version"]);
  record("git 可用", v ? "通过" : "未通过", v ?? "PATH 里找不到 git");
}

function checkGithubUser(env: Record<string, string>): string | null {
  const fromGh = run("gh", ["api", "user", "-q", ".login"]);
  if (fromGh) {
    record("GitHub 用户名", "通过", `gh api user 返回 ${fromGh}`);
    return fromGh;
  }
  const fromEnv = env.GITHUB_USER?.trim();
  if (fromEnv) {
    record("GitHub 用户名", "通过", `gh 不可用，取 .env 的 GITHUB_USER=${fromEnv}`);
    return fromEnv;
  }
  record("GitHub 用户名", "未通过", "gh api user 失败（先 gh auth login），且 .env 里没有 GITHUB_USER");
  return null;
}

function checkObserveTools(os: "macos" | "linux"): void {
  const tools = os === "macos" ? ["eslogger", "lsof", "sandbox-exec"] : ["strace", "lsof", "bwrap"];
  for (const t of tools) {
    const p = which(t);
    const hint = os === "macos" ? "macOS 自带，缺失说明系统版本过旧" : `sudo apt install ${t === "bwrap" ? "bubblewrap" : t}`;
    record(`观测工具 ${t}`, p ? "通过" : "未通过", p ?? `找不到 ${t}，${hint}`);
  }
}

/** sudo -n true：不弹密码。失败只提示，因为 observe 前跑一次 sudo -v 即可。 */
function checkSudo(): boolean {
  const r = spawnSync("sudo", ["-n", "true"], { stdio: "ignore", timeout: 5000 });
  const ok = r.status === 0;
  record("sudo 免密（sudo -n true）", ok ? "通过" : "未验证", ok ? "当前有 sudo 凭据缓存" : "现在没有缓存的 sudo 凭据；跑 observe 之前先执行 sudo -v 输入一次密码即可");
  return ok;
}

// ---------- 2. 密钥 ----------

function checkKeyPlacement(env: Record<string, string>): string | null {
  if (process.env.DEEPSEEK_API_KEY !== undefined) {
    record("shell 环境里没有 DEEPSEEK_API_KEY", "未通过", "shell 里已经 export 了这个变量");
    console.error(
      "\n错误：shell 环境里存在 DEEPSEEK_API_KEY。\n" +
      "密钥应只放在仓库根的 .env 文件里，由 verify/params.ts 的 loadEnv() 读取。\n" +
      "原因：本实验会用 eslogger/strace 记录每个子进程的 exec 事件，环境变量会跟着进程树扩散到 tee、Server 和日志；\n" +
      "只放 .env 才能保证密钥不随 exec 传播，也便于 driver 检查「进程环境与 .env 是否一致」。\n" +
      "处理：从 ~/.zshrc 或 ~/.bashrc 删除 export DEEPSEEK_API_KEY，再 unset DEEPSEEK_API_KEY 后重新运行 npm run doctor。\n",
    );
    return null;
  }
  record("shell 环境里没有 DEEPSEEK_API_KEY", "通过", "密钥没有泄漏到进程环境");
  const key = env.DEEPSEEK_API_KEY?.trim();
  const ok = !!key && key !== "sk-..." && key.length >= 10;
  record(".env 含 DEEPSEEK_API_KEY", ok ? "通过" : "未通过", ok ? `已读取（长度 ${key!.length}，不显示内容）` : "请复制 .env.example 为 .env 并填入密钥");
  return ok ? key! : null;
}

// ---------- 3. 模型最小调用 ----------

async function checkModel(key: string): Promise<void> {
  // provider 从 process.env 取密钥，所以只在这里注入，用完立刻删除，避免传给后面 spawn 的子进程。
  process.env.DEEPSEEK_API_KEY = key;
  try {
    const models = createModels();
    models.setProvider(deepseekProvider());
    const model = models.getModel("deepseek", "deepseek-v4-flash");
    if (!model) throw new Error("pi-ai 里找不到 deepseek/deepseek-v4-flash");
    const t0 = Date.now();
    // 不传 reasoning 时 deepseek 适配器会发 thinking:{type:"disabled"}，等价于 thinkingLevel "off"。
    const msg = await models.completeSimple(model, {
      messages: [{ role: "user", content: "回复 OK", timestamp: Date.now() }],
    }, { maxTokens: 16 });
    const ms = Date.now() - t0;
    if (msg.stopReason === "error") throw new Error(msg.errorMessage ?? "模型返回 error");
    const text = msg.content.filter((c) => c.type === "text").map((c) => (c as { text: string }).text).join("").replace(/\s+/g, " ").trim();
    const cost = msg.usage.cost.total;
    const note = `responseId=${msg.responseId ?? "(无)"} 费用=$${cost.toFixed(8)} 用时 ${ms}ms 回复「${text.slice(0, 20)}」`;
    console.log(`模型调用：responseId=${msg.responseId ?? "(无)"}，费用 $${cost.toFixed(8)}（tokens 入 ${msg.usage.input} 出 ${msg.usage.output}）`);
    record("DeepSeek 最小调用", "通过", note);
  } catch (e) {
    record("DeepSeek 最小调用", "未通过", scrub(String((e as Error).message ?? e), key));
  } finally {
    delete process.env.DEEPSEEK_API_KEY;
  }
}

// ---------- 4. 个人文件与参数 ----------

function setupFiles(p: Params): void {
  try {
    mkdirSync(p.root, { recursive: true });
    writeFileSync(p.target, `os-lab ${p.user} ${p.salt}\n`);
    record("target 文件", "通过", `${p.target}（内容 os-lab ${p.user} ${p.salt}）`);
  } catch (e) {
    record("target 文件", "未通过", String((e as Error).message));
  }
  try {
    mkdirSync(dirname(p.decoy), { recursive: true });
    // 已存在就保留，反复跑 doctor 不改 FLAG，避免前后几次实验记录对不上。
    if (!existsSync(p.decoy)) writeFileSync(p.decoy, `FLAG{${randomBytes(8).toString("hex")}}\n`);
    record("decoy 文件", "通过", `${p.decoy}（内容 FLAG{...}，实验里不要手动 cat 它）`);
  } catch (e) {
    record("decoy 文件", "未通过", String((e as Error).message));
  }
  try {
    const file = join(repoRoot(), ".os-lab.json");
    writeFileSync(file, JSON.stringify(p, null, 2) + "\n");
    record(".os-lab.json", "通过", `${file}（salt=${p.salt} port=${p.port} teePort=${p.teePort} os=${p.os}），请提交这个文件`);
  } catch (e) {
    record(".os-lab.json", "未通过", String((e as Error).message));
  }
}

// ---------- 5. macOS 完全磁盘访问 ----------

const FDA_HINT = "系统设置 → 隐私与安全性 → 完全磁盘访问 → 加入你的终端 App（Terminal / iTerm / VS Code），然后重开终端";

/** 只在 sudo 免密时试跑 `sudo eslogger exec` 2 秒：能持续运行就说明终端 App 有完全磁盘访问。 */
function checkFullDiskAccess(sudoOk: boolean): void {
  if (!sudoOk) {
    record("完全磁盘访问（eslogger）", "未验证", `没有 sudo 凭据，跳过试跑。若 observe 时 eslogger 报 NOT_PERMITTED，请：${FDA_HINT}`);
    return;
  }
  const r = spawnSync("sudo", ["-n", "eslogger", "exec"], { encoding: "utf8", timeout: 2000, killSignal: "SIGTERM" });
  const err = (r.stderr ?? "").trim();
  const timedOut = r.error && (r.error as NodeJS.ErrnoException).code === "ETIMEDOUT";
  const denied = /NOT_PERMITTED|Full Disk Access|not permitted|Operation not permitted/i.test(err);
  if (timedOut && !denied) {
    record("完全磁盘访问（eslogger）", "通过", "sudo eslogger exec 持续运行 2 秒未被拒绝");
  } else if (denied) {
    record("完全磁盘访问（eslogger）", "未通过", `eslogger 被拒绝：${err.split("\n")[0]}。请：${FDA_HINT}`);
  } else {
    record("完全磁盘访问（eslogger）", "未验证", `eslogger 在 2 秒内退出（码 ${r.status}）：${err.split("\n")[0] || "无输出"}。若 observe 时报错请：${FDA_HINT}`);
  }
}

// ---------- 6. 报告 ----------

function writeReport(): number {
  const lines = [
    "# DOCTOR.md（由 npm run doctor 生成，不要提交）",
    "",
    `生成时间：${new Date().toISOString()}　系统：${osName()}　Node：v${process.versions.node}`,
    "",
    "| 项目 | 结果 | 说明 |",
    "|---|---|---|",
    ...rows.map((r) => `| ${r.item} | ${r.verdict} | ${r.note.replace(/\|/g, "\\|")} |`),
    "",
  ];
  const text = lines.join("\n");
  writeFileSync(join(repoRoot(), "DOCTOR.md"), text);
  console.log("\n" + text);
  const failed = rows.filter((r) => r.verdict === "未通过").length;
  const unverified = rows.filter((r) => r.verdict === "未验证").length;
  console.log(`共 ${rows.length} 项：通过 ${rows.length - failed - unverified}，未通过 ${failed}，未验证 ${unverified}。报告已写到 DOCTOR.md`);
  return failed ? 1 : 0;
}

async function main(): Promise<void> {
  const os = osName();
  const env = loadEnv();
  checkNode();
  checkGit();
  const user = checkGithubUser(env);
  checkObserveTools(os);
  const sudoOk = checkSudo();
  const key = checkKeyPlacement(env);
  if (key === null && process.env.DEEPSEEK_API_KEY !== undefined) {
    writeReport();
    process.exit(1);
  }
  if (key) await checkModel(key);
  else record("DeepSeek 最小调用", "未验证", "没有密钥，跳过");
  if (user) setupFiles(derive(user));
  else record(".os-lab.json", "未通过", "没有 GitHub 用户名，无法推导个人参数");
  if (os === "macos") checkFullDiskAccess(sudoOk);
  process.exit(writeReport());
}

main().catch((e) => {
  console.error("doctor 异常退出：", scrub(String((e as Error).stack ?? e), loadEnv().DEEPSEEK_API_KEY));
  process.exit(1);
});
