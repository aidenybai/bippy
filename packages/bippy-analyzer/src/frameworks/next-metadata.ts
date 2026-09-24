import { readdirSync } from "node:fs";
import path from "node:path";
import type { Interpreter } from "../evaluate/interpreter.js";
import { nativeFunction } from "../evaluate/stubs.js";
import { describeThrow, getThrowCertainty } from "../evaluate/thrown.js";
import {
  listValue,
  NULL_VALUE,
  objectFromRecord,
  objectValue,
  primitiveValue,
  unknownValue,
} from "../evaluate/values.js";
import { isClientModule } from "../graph/module-record.js";
import type { ModuleRecord } from "../graph/module-types.js";
import { isVersionAtLeast } from "../libraries/installed-version.js";
import type { StaticRenderer } from "../render/static-renderer.js";
import type { StaticObjectValue, StaticValue } from "../types.js";
import { classifySegment, findRouteFile, listSubdirectories } from "./route-files.js";

export interface NextMetadataLayer {
  directory: string;
  filePath: string | null;
  props: StaticObjectValue;
}

export const usesNextMetadataTree = (version: string | null): boolean =>
  version !== null && isVersionAtLeast(version, "13.2.0") && !isVersionAtLeast(version, "13.3.0");

const hasMetadataImages = (directory: string, isRoot: boolean): boolean =>
  readdirSync(directory).some(
    (filename) =>
      /^(?:icon\d?\.(?:ico|jpg|jpeg|png|svg)|apple-icon\d?\.(?:jpg|jpeg|png)|(?:opengraph|twitter)-image\d?\.(?:jpg|jpeg|png|gif))$/.test(
        filename,
      ) ||
      (isRoot && /^favicon\d?\.ico$/.test(filename)),
  );

export const renderNextMetadata = (
  renderer: StaticRenderer,
  interpreter: Interpreter,
  layers: NextMetadataLayer[],
): StaticValue => {
  const resolveModule = (specifier: string): ModuleRecord | null => {
    const resolved = renderer.graph.resolver.resolve(
      specifier,
      path.join(renderer.options.rootDirectory, "package.json"),
    );
    return (resolved.kind === "internal" || resolved.kind === "external") &&
      resolved.filePath !== null
      ? renderer.graph.analyzeModule(resolved.filePath)
      : null;
  };
  resolveModule("next/dist/compiled/@edge-runtime/primitives/structured-clone");
  const metadataModule = resolveModule("next/dist/lib/metadata/metadata");
  const resolverModule = resolveModule("next/dist/lib/metadata/resolve-metadata");
  if (!metadataModule || !resolverModule)
    return unknownValue("Next MetadataTree source is unavailable");
  if (layers.some((layer, index) => hasMetadataImages(layer.directory, index === 0))) {
    return unknownValue("Next metadata image files require the metadata image loader");
  }
  if (
    layers.some((layer) => classifySegment(path.basename(layer.directory)).kind === "catch-all")
  ) {
    return unknownValue("Next metadata catch-all params are not modeled");
  }
  if (
    layers.some((layer) => listSubdirectories(layer.directory).some((name) => name.startsWith("@")))
  ) {
    return unknownValue("Next parallel-route metadata collection is not modeled");
  }
  const component = interpreter.evaluateModuleExport(metadataModule, "MetadataTree", "server");
  const items = listValue([]);
  const context = interpreter.createModuleContext(resolverModule, undefined, "server");
  const collect = interpreter.evaluateModuleExport(resolverModule, "collectMetadata", "server");
  for (const layer of layers) {
    const module = layer.filePath ? renderer.loadModule(layer.filePath) : null;
    if (layer.filePath && !module) return unknownValue(`could not parse ${layer.filePath}`);
    const loader = nativeFunction("metadata module", (): StaticValue =>
      module && !isClientModule(module) ? { kind: "namespace", module } : NULL_VALUE,
    );
    const tree = listValue([
      primitiveValue(""),
      objectValue(),
      objectFromRecord({ layout: listValue([loader]) }),
    ]);
    const collected = interpreter.callAwaited(collect, [tree, layer.props, items], context, null);
    if (getThrowCertainty(collected) === "always") {
      interpreter.report("next-metadata", describeThrow(collected), null, "error");
      return collected;
    }
    if (collected.kind !== "primitive" || collected.value !== undefined) {
      return unknownValue("Next metadata collection did not complete");
    }
  }
  const metadata = interpreter.createElement(
    component,
    objectFromRecord({ metadata: items }),
    null,
    [],
    null,
    "MetadataTree",
    interpreter.createModuleContext(metadataModule, undefined, "server"),
  );
  for (const layer of layers.toReversed()) {
    const headPath = findRouteFile(layer.directory, "head");
    if (!headPath) continue;
    const headModule = renderer.loadModule(headPath);
    const head = headModule
      ? interpreter.createElement(
          interpreter.evaluateModuleExport(headModule, "default", "server"),
          objectFromRecord({
            params: interpreter.getProperty(layer.props, "params", context, null),
          }),
          null,
          [],
          null,
          "head",
          interpreter.createModuleContext(headModule, undefined, "server"),
        )
      : unknownValue(`could not parse ${headPath}`);
    return listValue([metadata, head]);
  }
  return metadata;
};
