import { generateReactInternals } from "./react-internals-plugin";

await generateReactInternals({
  mode: process.argv.includes("--check") ? "check" : "generate",
});
