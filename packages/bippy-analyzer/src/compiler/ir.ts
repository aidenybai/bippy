import type { Node } from "oxc-parser";
import type { StaticPrimitive } from "../types.js";

export interface FlowVariable {
  id: number;
  name: string;
  storage: "local" | "cell" | "temporary" | "effect";
}

export interface FlowInstruction {
  id: number;
  kind:
    | "constant"
    | "input"
    | "uninitialized"
    | "copy"
    | "read"
    | "unary"
    | "binary"
    | "opaque"
    | "load-cell"
    | "store-cell"
    | "effect";
  target: number;
  operands: number[];
  node: Node | null;
  operator?: string;
  constant?: StaticPrimitive;
}

export interface FlowEdge {
  id: number;
  from: number;
  to: number;
  kind: "normal" | "truthy" | "falsy" | "nullish" | "defined" | "throw" | "resume" | "return";
}

export interface FlowTerminal {
  kind: "jump" | "branch" | "invoke" | "return" | "throw" | "unreachable";
  value: number | null;
  edges: number[];
}

export interface FlowBlock {
  id: number;
  instructions: FlowInstruction[];
  predecessors: number[];
  terminal: FlowTerminal;
}

export interface ControlFlowGraph {
  entry: number;
  blocks: Map<number, FlowBlock>;
  edges: Map<number, FlowEdge>;
  variables: Map<number, FlowVariable>;
}

export interface SsaPhi {
  target: number;
  variable: number;
  operands: Map<number, number>;
}

export interface SsaDefinition {
  id: number;
  variable: number;
  block: number;
  instruction: number | null;
}

export interface SsaBlock extends FlowBlock {
  phis: SsaPhi[];
}

export interface SsaGraph extends ControlFlowGraph {
  blocks: Map<number, SsaBlock>;
  definitions: Map<number, SsaDefinition>;
}

export interface ConstantFact {
  kind: "unreached" | "constant" | "overdefined";
  value?: StaticPrimitive;
}

export interface ConstantAnalysis {
  values: Map<number, ConstantFact>;
  executableEdges: Set<number>;
  executableBlocks: Set<number>;
}

export class CompilerInvariantError extends Error {}

export class UnsupportedControlFlow extends Error {
  constructor(
    readonly node: Node,
    reason: string = node.type,
  ) {
    super(reason);
  }
}

export const getRequired = <Key, Value>(map: ReadonlyMap<Key, Value>, key: Key): Value => {
  const value = map.get(key);
  if (value === undefined)
    throw new CompilerInvariantError(`Missing compiler entry ${String(key)}`);
  return value;
};

export const getReversePostorder = (graph: ControlFlowGraph): number[] => {
  const visited = new Set<number>([graph.entry]);
  const stack = [{ block: graph.entry, next: 0 }];
  const result: number[] = [];
  while (stack.length) {
    const frame = stack[stack.length - 1];
    const edges = getRequired(graph.blocks, frame.block).terminal.edges;
    if (frame.next === edges.length) {
      result.push(frame.block);
      stack.pop();
    } else {
      const successor = getRequired(graph.edges, edges[frame.next++]).to;
      if (!visited.has(successor)) {
        visited.add(successor);
        stack.push({ block: successor, next: 0 });
      }
    }
  }
  return result.reverse();
};
