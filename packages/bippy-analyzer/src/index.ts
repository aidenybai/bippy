export * from "./errors.js";
export { Interpreter, type InterpreterOptions } from "./evaluate/interpreter.js";
export { describeValue, objectFromRecord, objectValue, unknownValue } from "./evaluate/values.js";
export { ModuleGraph, type ModuleGraphOptions } from "./graph/module-graph.js";
export { createModuleRecord } from "./graph/module-record.js";
export { ModuleResolver, type ModuleResolverOptions } from "./graph/module-resolver.js";
export * from "./graph/module-types.js";
export { ensureDomGlobals } from "./materialize/dom-environment.js";
export { MARKER_NAMES } from "./materialize/markers.js";
export { Materializer, type MaterializerOptions } from "./materialize/materializer.js";
export { mountNode, type MountResult } from "./materialize/mount.js";
export { loadReactRuntime, type ReactRuntime } from "./materialize/react-runtime.js";
export {
  EMPTY_OBSERVATIONS,
  getOpaqueCaptureDescription,
  opaqueCapture,
  readObservationsJson,
} from "./observations.js";
export {
  SUPPORTED_SOURCE_EXTENSIONS,
  SourceFileCache,
  getSourceLanguage,
  parseSourceText,
} from "./parse/parse-source-file.js";
export { getSourceLocation } from "./parse/source-location.js";
export type {
  Diagnostic,
  DiagnosticSeverity,
  FunctionLikeNode,
  JsxPragma,
  ParsedSourceFile,
  SourceLanguage,
  SourceLocation,
  SourceTransform,
  TransformedSource,
} from "./parse/source-types.js";
export { toElementType } from "./react/element-type.js";
export { findRootRenderCalls, type RootRenderCall } from "./render/find-root-elements.js";
export {
  StaticRenderer,
  createStaticRenderer,
  type RenderComponentOptions,
} from "./render/static-renderer.js";
export * from "./render/types.js";
export * from "./types.js";
export * from "./work-tags.js";
