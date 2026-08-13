import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import {
  getSourceContentFromSourceMap,
  getSourceFromSourceMap,
  getSourceFromSourceMapByFunctionName,
  getSourceMap,
} from "bippy/source";

const fixtureDirectory = resolve(import.meta.dirname, "../../../e2e-expo");
const bundleUrl = "app://react-native/index.bundle";
const sourceMapUrl = "app://react-native/index.map";

const getGeneratedPosition = (bundleContent, marker) => {
  const markerIndex = bundleContent.indexOf(marker);
  assert.notEqual(markerIndex, -1, `Metro bundle did not contain ${marker}`);
  const contentBeforeMarker = bundleContent.slice(0, markerIndex);
  const generatedLines = contentBeforeMarker.split("\n");
  return {
    column: generatedLines.at(-1).length,
    line: generatedLines.length,
  };
};

test("symbolicates a real minified Metro production artifact", async () => {
  const requestedUrls = [];
  const sourceFetch = async (url) => {
    requestedUrls.push(url);
    const artifactPath =
      url === bundleUrl
        ? resolve(fixtureDirectory, "index.bundle")
        : resolve(fixtureDirectory, "index.map");
    return new Response(await readFile(artifactPath, "utf8"));
  };
  const [bundleContent, sourceMap] = await Promise.all([
    readFile(resolve(fixtureDirectory, "index.bundle"), "utf8"),
    getSourceMap(bundleUrl, false, sourceFetch),
  ]);

  assert.ok(sourceMap);
  assert.deepEqual(requestedUrls, [bundleUrl, sourceMapUrl]);

  const appPosition = getGeneratedPosition(bundleContent, "test-child");
  const appSource = getSourceFromSourceMap(sourceMap, appPosition.line, appPosition.column);
  assert.match(appSource?.fileName ?? "", /\/src\/App\.tsx$/);
  assert.match(
    getSourceContentFromSourceMap(sourceMap, appSource.fileName) ?? "",
    /const TestChild/,
  );

  const skiaPosition = getGeneratedPosition(bundleContent, "skia-context-default");
  const skiaSource = getSourceFromSourceMap(sourceMap, skiaPosition.line, skiaPosition.column);
  assert.match(skiaSource?.fileName ?? "", /\/src\/skia-probe\.tsx$/);
  assert.match(
    getSourceContentFromSourceMap(sourceMap, skiaSource.fileName) ?? "",
    /const SkiaMemoLeaf/,
  );

  const skiaComponentSource = getSourceFromSourceMapByFunctionName(sourceMap, "SkiaMemoLeaf");
  assert.match(skiaComponentSource?.fileName ?? "", /\/src\/skia-probe\.tsx$/);
  assert.ok(skiaComponentSource?.lineNumber > 0);
});
