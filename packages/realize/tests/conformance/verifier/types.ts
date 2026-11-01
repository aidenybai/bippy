import type { ComponentAnalysis, Sample } from "../../../src/core/types";
import type { MountFailure } from "./reasons";

export const ENTRY_PATH = "/__bippy_verify_entry.ts";
export const PROVIDERS_PATH = "/__bippy_verify_providers.ts";
export const SETUP_PATH = "/__bippy_verify_setup.tsx";
export const WRAPPER_PATH = "/__bippy_verify_wrapper.ts";
export const TRUNCATED_VALUE = "[truncated]";
export const MAX_ACTION_LABEL_LENGTH = 40;

const PROP_ORIGIN_PREFIX = "prop:";
const STATE_ORIGIN_PREFIX = "state:";

interface MutationOrigin {
  kind: "prop" | "state";
  name: string;
}

export const getPropOrigin = (propName: string): string => `${PROP_ORIGIN_PREFIX}${propName}`;

export const getStateOrigin = (hookIndex: number): string => `${STATE_ORIGIN_PREFIX}${hookIndex}`;

export const parseOrigin = (origin: string): MutationOrigin =>
  origin.startsWith(PROP_ORIGIN_PREFIX)
    ? { kind: "prop", name: origin.slice(PROP_ORIGIN_PREFIX.length) }
    : { kind: "state", name: origin.slice(STATE_ORIGIN_PREFIX.length) };

export type Shape =
  | { kind: "element"; tag: string; children: Shape[] }
  | { kind: "component"; name: string }
  | { kind: "text"; text: string };

type CounterKind = "truthy" | "nullish" | "mutation" | "host-handler" | "component-callbacks";

export interface Counter {
  id: string;
  file: string;
  start: number;
  end: number;
  kind: CounterKind;
}

export interface BranchHit {
  id: string;
  isConsequent: boolean;
}

export interface MutationHit {
  id: string;
  origin: string | null;
  isWritten: boolean;
  isLost: boolean;
}

export interface Capture {
  shapes: Shape[];
  stateValues: unknown[];
  branchHits: BranchHit[];
  handlerCalls: string[];
  mutationHits: MutationHit[];
  mutatedOrigins: string[];
  error: string | null;
  errorDepth: number | null;
  failure: MountFailure | null;
}

export interface Action {
  key: string;
  kind: "click" | "change" | "submit" | "keydown" | "focus" | "blur" | "hover" | "unhover";
  tag: string;
  label: string;
}

export interface Scenario {
  name: string;
  args: unknown[];
}

interface ProjectCandidate {
  kind: "project";
  file: string;
  exportName: string;
  props: Record<string, Sample>;
}

interface PackageCandidate {
  kind: "package";
  specifier: string;
  namespace: string | null;
  exportName: string;
  importer: string;
  props: Record<string, Sample>;
}

type WrapperCandidate = ProjectCandidate | PackageCandidate;

export type WrapperSource = "named" | "root" | "part" | "context";

export interface Wrapper {
  name: string;
  source: WrapperSource;
  candidate: WrapperCandidate;
}

export interface ExportedName {
  file: string;
  exportName: string;
}

export interface ModuleExport {
  name: string;
  exportName: string;
}

export interface AliasResolver {
  (specifier: string, importer: string): Promise<string | null>;
}

export interface PackageImport {
  specifier: string;
  names: string[];
}

export interface FileImports {
  packages: PackageImport[];
  files: string[];
}

export interface SourceIndex {
  exports: Map<string, ExportedName[]>;
  imports: Map<string, FileImports>;
}

export interface ProjectIndex extends SourceIndex {
  components: Map<string, ComponentAnalysis>;
  contextSamples: Map<string, Sample>;
}

export interface ComponentModule {
  url: string;
  importerUrls: string[];
}

export interface MountRequest {
  module: ComponentModule;
  exportName: string;
  props: Record<string, Sample>;
  scenario: Scenario | null;
  wrappers: Wrapper[];
}

interface VerifyApi {
  mount: (request: MountRequest) => Promise<Capture>;
  actions: () => Action[];
  perform: (key: string) => Promise<Capture | null>;
  hasActionTimers: () => boolean;
  observe: () => Promise<Capture>;
  canLoad: (wrapper: Wrapper) => Promise<boolean>;
}

declare global {
  interface Window {
    __verify: VerifyApi;
  }
  var __bippyCoverage: (id: string, kind: CounterKind, value: unknown) => unknown;
}
