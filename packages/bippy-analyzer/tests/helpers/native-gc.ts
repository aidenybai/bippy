import { execFileSync } from "node:child_process";

export const getNativeGcObservation = (setup: string, observation: string): string =>
  execFileSync(
    process.execPath,
    [
      "--expose-gc",
      "--input-type=module",
      "--eval",
      `${setup}\nawait new Promise(resolve => setImmediate(resolve)); globalThis.gc(); console.log(${observation});`,
    ],
    { encoding: "utf8", timeout: 10000, maxBuffer: 1024 * 1024 },
  ).trim();
