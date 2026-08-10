import { generateReactInternals } from "./react-internals-plugin.js";

await generateReactInternals({
  mode:
    process.argv.includes("--check") || (process.env.CI && process.env.CI !== "false")
      ? "check"
      : "generate",
});
