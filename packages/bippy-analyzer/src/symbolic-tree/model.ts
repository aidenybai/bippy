export interface SourceSpan {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}

export type Domain =
  | { kind: "cases"; cases: string[]; origin: "type" | "call-sites" | "reachable" }
  | { kind: "opaque"; typeText: string }
  | { kind: "unknown"; reason: string };

export type SlotSource = "prop" | "state" | "reducer" | "context" | "hook" | "ref" | "item";

export interface Slot {
  name: string;
  source: SlotSource;
  domain: Domain;
  initial?: Expression;
  hookName?: string;
}

export type Expression =
  | { kind: "literal"; text: string }
  | { kind: "slot"; slot: string; path: string[] }
  | { kind: "unary"; operator: string; operand: Expression }
  | { kind: "binary"; operator: string; left: Expression; right: Expression }
  | { kind: "conditional"; condition: Expression; whenTrue: Expression; whenFalse: Expression }
  | { kind: "object"; fields: ObjectField[] }
  | { kind: "array"; spreads: Expression[]; itemCount: number }
  | { kind: "opaque"; text: string; reason: string };

export interface ObjectField {
  name: string;
  value: Expression;
}

export interface Attribute {
  name: string;
  value: string;
  literal?: string;
  transitionId?: string;
}

export type RenderNode =
  | {
      kind: "element";
      tag: string;
      isComponent: boolean;
      attributes: Attribute[];
      children: RenderNode[];
    }
  | { kind: "text"; text: string }
  | { kind: "value"; expression: Expression }
  | {
      kind: "branch";
      condition: Expression;
      whenTrue: RenderNode;
      whenFalse: RenderNode;
      span: SourceSpan;
    }
  | { kind: "list"; source: Expression; item: RenderNode }
  | { kind: "empty" }
  | { kind: "unknown"; reason: string; text: string };

export interface Update {
  slot: string;
  value: Expression;
  guards: Expression[];
  isAsync: boolean;
}

export interface Transition {
  id: string;
  trigger: string;
  updates: Update[];
  delegates: string[];
  span: SourceSpan;
}

export interface Bailout {
  reason: string;
  text: string;
  line: number;
  span?: SourceSpan;
}

export interface ComponentModel {
  name: string;
  file: string;
  line: number;
  slots: Slot[];
  atoms: Map<string, Domain>;
  render: RenderNode;
  transitions: Transition[];
  renders: string[];
  bailouts: Bailout[];
}

export interface Edge {
  transitionId: string;
  targets: number[];
  isAsync: boolean;
}

export interface State {
  assumptions: string[];
  render: RenderNode;
  edges: Edge[];
}
