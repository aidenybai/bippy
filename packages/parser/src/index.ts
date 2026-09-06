export * from "./types.js";
export * from "./work-tags.js";
export {
  parseSourceText,
  getSourceLanguage,
  SourceFileCache,
  SUPPORTED_SOURCE_EXTENSIONS,
} from "./parse/parse-source-file.js";
export { getSourceLocation } from "./parse/source-location.js";
export { ModuleResolver, type ModuleResolverOptions } from "./graph/module-resolver.js";
export { ModuleGraph, type ModuleGraphOptions } from "./graph/module-graph.js";
export { createModuleRecord } from "./graph/module-record.js";
export { Interpreter, type InterpreterOptions } from "./evaluate/interpreter.js";
export { describeValue, objectValue, objectFromRecord, unknownValue } from "./evaluate/values.js";
export { toElementType } from "./react/element-type.js";
export {
  EMPTY_OBSERVATIONS,
  getOpaqueCaptureDescription,
  opaqueCapture,
  readObservationsJson,
} from "./observations.js";
export { Materializer, type MaterializerOptions } from "./materialize/materializer.js";
export { MARKER_NAMES } from "./materialize/markers.js";
export { loadReactRuntime, type ReactRuntime } from "./materialize/react-runtime.js";
export { ensureDomGlobals } from "./materialize/dom-environment.js";
export { mountNode, type MountResult } from "./materialize/mount.js";
export {
  StaticRenderer,
  createStaticRenderer,
  type RenderComponentOptions,
} from "./render/static-renderer.js";
export { findRootRenderCalls, type RootRenderCall } from "./render/find-root-elements.js";
