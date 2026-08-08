import { generateReactInternals } from "./react-internals-plugin.js";

await generateReactInternals({
  mode: process.argv.includes("--check") ? "check" : "generate",
});
