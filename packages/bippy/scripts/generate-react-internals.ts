import { generateReactInternals } from "./react-internals-generator";

await generateReactInternals({
  mode: process.argv.includes("--check") ? "check" : "generate",
});
