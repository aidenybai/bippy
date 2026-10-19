import type { ComponentAnalysis, Sample } from "../../../src/core/types";
import type { MountFailure } from "./reasons";

export const ENTRY_PATH = "/__bippy_verify_entry.ts";
export const PROVIDERS_PATH = "/__bippy_verify_providers.ts";
export const SETUP_PATH = "/__bippy_verify_setup.tsx";
export const WRAPPER_PATH = "/__bippy_verify_wrapper.ts";
export const TRUNCATED_VALUE = "[truncated]";
export const MAX_ACTION_LABEL_LENGTH = 40;

const PROP_OWNER_PREFIX = "prop:";
const STATE_OWNER_PREFIX = "state:";

export interface MutationOwner {
  kind: "prop" | "state";
  name: string;
}

export const getPropOwner = (propName: string): string => `${PROP_OWNER_PREFIX}${propName}`;

export const getStateOwner = (hookIndex: number): string => `${STATE_OWNER_PREFIX}${hookIndex}`;

export const parseOwner = (owner: string): MutationOwner =>
  owner.startsWith(PROP_OWNER_PREFIX)
    ? { kind: "prop", name: owner.slice(PROP_OWNER_PREFIX.length) }
    : { kind: "state", name: owner.slice(STATE_OWNER_PREFIX.length) };

export type Shape =
  | { kind: "element"; tag: string; children: Shape[] }
  | { kind: "component"; name: string }
  | { kind: "text"; text: string };

export type ProbeMode = "truthy" | "nullish" | "mutation" | "handler" | "callbacks";

export interface Probe {
  id: string;
  file: string;
  start: number;
  end: number;
  mode: ProbeMode;
}

export interface ProbeHit {
  id: string;
  isTrueSide: boolean;
}

export interface MutationHit {
  id: string;
  owner: string | null;
  isWritten: boolean;
  isLost: boolean;
}

export interface Capture {
  shapes: Shape[];
  hookStates: unknown[];
  probes: ProbeHit[];
  handlerHits: string[];
  mutationHits: MutationHit[];
  mutatedOwners: string[];
  firstCommitShapes: Shape[] | null;
  error: string | null;
  errorDepth: number | null;
  failure: MountFailure | null;
}

export interface Action {
  key: string;
  kind: "click" | "change" | "submit";
  tag: string;
  label: string;
  isInChild: boolean;
}

export interface Scenario {
  name: string;
  args: unknown[];
}

export interface ProjectCandidate {
  kind: "project";
  file: string;
  exportName: string;
  props: Record<string, Sample>;
}

export interface PackageCandidate {
  kind: "package";
  specifier: string;
  namespace: string | null;
  exportName: string;
  importer: string;
  props: Record<string, Sample>;
}

export type WrapperCandidate = ProjectCandidate | PackageCandidate;

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
  observe: () => Promise<Capture>;
  canLoad: (wrapper: Wrapper) => Promise<boolean>;
}

declare global {
  interface Window {
    __verify: VerifyApi;
  }
  var __bippyProbe: (id: string, mode: ProbeMode, value: unknown) => unknown;
}
