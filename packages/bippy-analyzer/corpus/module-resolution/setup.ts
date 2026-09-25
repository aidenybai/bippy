import { execFileSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { getCorpusRoot, getProjects } from "./context.js";

const root = getCorpusRoot();
if (existsSync(root))
  throw new Error("Use a new corpus directory; existing evidence is not overwritten");
for (const name of ["projects", "reports", "tools/corpus/module-resolution", "home"])
  mkdirSync(join(root, name), { recursive: true });
copyFileSync(
  fileURLToPath(new URL("./manifest.json", import.meta.url)),
  join(root, "manifest.json"),
);
copyFileSync(
  fileURLToPath(new URL("./corpus.test.ts", import.meta.url)),
  join(root, "tools/corpus/module-resolution/corpus.test.ts"),
);
cpSync(fileURLToPath(new URL("../../src", import.meta.url)), join(root, "tools/src"), {
  recursive: true,
});
copyFileSync(
  fileURLToPath(new URL("./tools-package.json", import.meta.url)),
  join(root, "tools/package.json"),
);
writeFileSync(
  join(root, "tools/package-lock.json"),
  gunzipSync(readFileSync(new URL("./locks/tools-package-lock.json.gz", import.meta.url))),
);
const env = {
  PATH: process.env.PATH,
  HOME: join(root, "home"),
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_TERMINAL_PROMPT: "0",
};
for (const project of getProjects(root)) {
  const directory = join(root, "projects", project.id);
  execFileSync("git", ["init", directory], { env, stdio: "ignore" });
  execFileSync(
    "git",
    ["-C", directory, "fetch", "--depth=1", project.repository, project.revision],
    { env, stdio: "inherit", timeout: 120000 },
  );
  execFileSync("git", ["-C", directory, "checkout", "--detach", "FETCH_HEAD"], {
    env,
    stdio: "inherit",
  });
  const revision = execFileSync("git", ["-C", directory, "rev-parse", "HEAD"], {
    env,
    encoding: "utf8",
  }).trim();
  if (revision !== project.revision) throw new Error(`${project.id}: revision mismatch`);
}
