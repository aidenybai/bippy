import assert from "node:assert/strict";
import { resolve } from "node:path";
import { $ } from "bun";
import {
  conformanceDirectory,
  getPortTitles,
  getTestTitles,
  readUpstreamManifest,
} from "./test-inventory";

const sourceDirectory = process.env.REACT_SOURCE;
if (!sourceDirectory)
  throw new Error(
    "Set REACT_SOURCE to a local facebook/react checkout at the revision in upstream.json.",
  );
const manifest = readUpstreamManifest();
assert.equal((await $`git -C ${sourceDirectory} rev-parse HEAD`.text()).trim(), manifest.revision);
for (const [path, hash] of Object.entries(manifest.sources)) {
  assert.equal(
    new Bun.CryptoHasher("sha256")
      .update(await Bun.file(resolve(sourceDirectory, path)).bytes())
      .digest("hex"),
    hash,
    path,
  );
}
for (const port of manifest.ports) {
  const upstreamTitles: string[] = getTestTitles(resolve(sourceDirectory, port.upstream));
  const localTitles = getTestTitles(resolve(conformanceDirectory, port.local));
  const expectedTitles = getPortTitles(manifest, port);
  if (port.scope === "complete-development-suite")
    assert.deepEqual([...upstreamTitles].sort(), [...expectedTitles].sort(), port.upstream);
  for (const title of expectedTitles) {
    assert.ok(upstreamTitles.includes(title), `Missing upstream case: ${title}`);
    assert.ok(localTitles.includes(title), `Missing local port: ${title}`);
  }
}
console.log(
  `Verified ${Object.keys(manifest.sources).length} source hashes and ${manifest.ports.reduce((count, port) => count + getPortTitles(manifest, port).length, 0)} direct ports at ${manifest.revision}`,
);
