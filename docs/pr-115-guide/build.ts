import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const revision = "c9cfc18ff6455211f9c53323ef35f75f67ba8684";
const directory = new URL("./", import.meta.url);
const template = await readFile(new URL("page.html", directory), "utf8");
const stylesheet = await readFile(new URL("styles.css", directory), "utf8");
const stylePlaceholder = /<style data-guide-style>\s*<\/style>/;
if (!stylePlaceholder.test(template))
  throw new Error("The guide stylesheet placeholder is missing");
const scriptPlaceholder = 'void "{{INTERACTIONS}}";';
if (!template.includes(scriptPlaceholder))
  throw new Error("The guide script placeholder is missing");
const bundled = await build({
  entryPoints: [fileURLToPath(new URL("interactions.ts", directory))],
  bundle: true,
  write: false,
  format: "iife",
  target: "es2022",
  minify: true,
  legalComments: "none",
});
const javascript = bundled.outputFiles[0]?.text;
if (!javascript) throw new Error("The guide interaction bundle is empty");
const html = template
  .replace(stylePlaceholder, () => `<style>${stylesheet}</style>`)
  .replaceAll("{{REVISION}}", revision)
  .replaceAll(
    /href="source:([^"]+)"/g,
    (_match, source: string) =>
      `href="https://github.com/aidenybai/bippy/blob/${revision}/packages/bippy-analyzer/${source}"`,
  )
  .replace(scriptPlaceholder, () => javascript.replaceAll("</script", "<\\/script"));
if (/\{\{[A-Z_]+\}\}/.test(html)) throw new Error("The guide has unresolved placeholders");
const output = new URL("../pr-115-explained.html", directory);
await writeFile(output, html);
execFileSync("pnpm", ["exec", "vp", "fmt", fileURLToPath(output)], { stdio: "inherit" });
console.log(`Built ${fileURLToPath(output)}`);
