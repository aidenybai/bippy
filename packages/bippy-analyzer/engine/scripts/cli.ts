#!/usr/bin/env -S tsx
import { registerHooks } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { outputDirectory, upstreamDirectory, verifyEngineBuild } from "../manifest.js";

await verifyEngineBuild();
const publishedEngine = pathToFileURL(join(upstreamDirectory, "lib/engine262.mjs")).href;
const builtEngine = pathToFileURL(join(outputDirectory, "engine.mjs")).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    const resolved = nextResolve(specifier, context);
    return resolved.url === publishedEngine ? { ...resolved, url: builtEngine } : resolved;
  },
});
await import(pathToFileURL(join(upstreamDirectory, "lib/node/bin.mjs")).href);
