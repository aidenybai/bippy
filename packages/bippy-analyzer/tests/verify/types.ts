import type { Sample } from "../../src/core/inference/types.js";

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
}

export interface Action {
  key: string;
  tag: string;
  label: string;
  kind: "click" | "change";
}

export interface Scenario {
  name: string;
  args: unknown[];
}

export interface WrapperCandidate {
  specifier: string;
  importer: string;
  exportName: string;
  isRootAllowed: boolean;
}

/**
 * A parent a component needs to render, like Radix's `Dialog` around a `DialogTitle`, with
 * the modules it may come from, tried in order.
 */
export interface Wrapper {
  name: string;
  candidates: WrapperCandidate[];
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
}

declare global {
  interface Window {
    __verify: VerifyApi;
  }
  var __bippyProbe: (id: string, mode: ProbeMode, value: unknown) => unknown;
}
