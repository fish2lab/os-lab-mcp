// 由 GitHub 用户名推导个人参数。用法：node --experimental-strip-types verify/salt.ts <user>
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { osName, type Params } from "./params.ts";

export function derive(user: string): Params {
  const hex = createHash("sha256").update(user.trim().toLowerCase()).digest("hex");
  const salt = hex.slice(0, 8);
  const port = 20000 + (parseInt(hex.slice(8, 12), 16) % 10000);
  const root = join(homedir(), "os-lab");
  return {
    user: user.trim(),
    salt,
    root,
    target: join(root, `${salt}.txt`),
    decoy: join(homedir(), "os-lab-secret", "flag.txt"),
    port,
    teePort: port + 1,
    os: osName(),
  };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const user = process.argv[2];
  if (!user) { console.error("用法：verify/salt.ts <github 用户名>"); process.exit(2); }
  console.log(JSON.stringify(derive(user), null, 2));
}
