import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const revision = "045bf6f9966ce3291b8fbc1e0403cd97b9201b00";
const directory = fileURLToPath(new URL("../.test262", import.meta.url));
const git = (args: string[]): string =>
  execFileSync("git", args, {
    cwd: directory,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();

if (!existsSync(directory)) {
  mkdirSync(directory);
  git(["init"]);
  git(["fetch", "--depth=1", "https://github.com/tc39/test262.git", revision]);
  git(["checkout", "--detach", "FETCH_HEAD"]);
}
if (git(["rev-parse", "HEAD"]) !== revision)
  throw new Error(`Expected Test262 revision ${revision}; existing checkout was not changed`);
if (git(["status", "--porcelain", "--untracked-files=all"]))
  throw new Error("Test262 checkout has local changes; existing checkout was not changed");
console.error(`Test262 ${revision} ready at ${directory}`);
