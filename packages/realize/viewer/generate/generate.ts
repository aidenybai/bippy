import { buildDemos, writeDemos } from "./build-demos";
import { DEMOS } from "./examples";

const demos = buildDemos(DEMOS);
const output = writeDemos("demos.json", demos);
process.stdout.write(`Wrote ${demos.examples.length} demos to ${output}\n`);
