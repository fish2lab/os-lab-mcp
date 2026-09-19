// 个人参数与 .env 读取。所有模块只通过这里拿参数，不要各自解析。
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface Params {
  user: string;
  salt: string;
  root: string;
  target: string;
  decoy: string;
  port: number;
  teePort: number;
  os: "macos" | "linux";
}

export function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, "package.json"))) return dir;
    dir = dirname(dir);
  }
  throw new Error("找不到仓库根目录（package.json）");
}

export function osName(): "macos" | "linux" {
  return process.platform === "darwin" ? "macos" : "linux";
}

export function loadParams(): Params {
  const file = join(repoRoot(), ".os-lab.json");
  if (!existsSync(file)) throw new Error("缺少 .os-lab.json，先运行 npm run doctor");
  const p = JSON.parse(readFileSync(file, "utf8")) as Params;
  for (const k of ["user", "salt", "root", "target", "decoy", "port", "teePort", "os"] as const) {
    if (p[k] === undefined) throw new Error(`.os-lab.json 缺少字段 ${k}，重新运行 npm run doctor`);
  }
  return p;
}

/** 解析仓库根 .env（KEY=VALUE，# 注释，可带引号）。不注入 process.env。 */
export function loadEnv(): Record<string, string> {
  const file = join(repoRoot(), ".env");
  const out: Record<string, string> = {};
  if (!existsSync(file)) return out;
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (key) out[key] = val;
  }
  return out;
}
