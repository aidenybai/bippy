import { resolve } from "node:path";
import { inspect } from "node:util";
import { z } from "zod";
import { runProbe } from "./probe.js";

const file = process.argv[2];
if (!file)
  throw new Error("Usage: render:engine262 <component-file> [props-json] [interactions-json]");
const props = z
  .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
  .parse(JSON.parse(process.argv[3] ?? "{}"));
const interactions = z
  .array(
    z.object({
      selector: z.string(),
      type: z.enum(["click", "input"]),
      value: z.string().optional(),
    }),
  )
  .parse(JSON.parse(process.argv[4] ?? "[]"));
const result = await runProbe({
  backend: "engine262",
  filePath: resolve(file),
  props,
  interactions,
});
await new Promise<void>((resolveWrite) =>
  process.stdout.write(`${inspect(result, { depth: null, colors: process.stdout.isTTY })}\n`, () =>
    resolveWrite(),
  ),
);
process.exit(result.errors.length || result.unsupported.length || result.hasPendingWork ? 1 : 0);
