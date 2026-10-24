import { buildDemos } from "./build-demos";

const [file] = process.argv.slice(2);
if (file === undefined) {
  process.stderr.write("Usage: tsx generate/analyze-file.ts <file>\n");
  process.exit(1);
}
process.stdout.write(JSON.stringify(buildDemos([file])));
