import type { ComponentAnalysis, Sample } from "../../src/core/types.js";
import type { MountFailure } from "./reasons.js";

export const PROVIDERS_PATH = "/__bippy_verify_providers.ts";
export const SETUP_PATH = "/__bippy_verify_setup.tsx";
export const WRAPPER_PATH = "/__bippy_verify_wrapper.ts";
export const TRUNCATED_VALUE = "[truncated]";

export type Shape =
  | { kind: "element"; tag: string; children: Shape[] }
  | { kind: "component"; name: string }
  | { kind: "text"; text: string };

export type ProbeMode = "truthy" | "nullish" | "mutation";

export interface ProbeHit {
  id: string;
  outcome: boolean;
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
  mutationHits: MutationHit[];
  mutatedOwners: string[];
  firstCommitShapes: Shape[] | null;
  error: string | null;
  errorDepth: number | null;
  failure: MountFailure | null;
}

export interface ActionTarget {
  tag: string;
  label: string;
}

export interface Action extends ActionTarget {
  key: string;
  kind: "click" | "change";
  isInChild: boolean;
  clickAncestors: ActionTarget[];
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

export interface MountRequest {
  moduleUrl: string;
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
