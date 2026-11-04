import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";
import type { NodePath } from "@babel/traverse";
import type * as t from "@babel/types";
import type {
  CodeGraph,
  GraphEdge,
  GraphNode,
  ViewBinding,
  ViewBranch,
  ViewHandler,
  ViewLocation,
} from "@/model";

interface TriggerSite {
  handlerId: string;
  loc: ViewLocation;
  name: string;
}

type GraphBinding = Omit<ViewBinding, "nodeIds">;

type GraphHandler = Omit<ViewHandler, "nodeIds">;

interface Reference {
  name: string;
  loc: ViewLocation;
  isCall: boolean;
}

interface StateDeclarator {
  stateName: string;
  setterName: string;
  loc: ViewLocation;
}

interface JsxAttributeSite {
  nameLoc: ViewLocation;
  valueLoc: ViewLocation;
}

export interface ParsedSource {
  references: Reference[];
  declarators: StateDeclarator[];
  attributes: JsxAttributeSite[];
}

interface GraphInput {
  component: string;
  parsed: ParsedSource;
  componentLoc: ViewLocation | null;
  bindings: GraphBinding[];
  branches: ViewBranch[];
  handlers: GraphHandler[];
  triggers: TriggerSite[];
}

const traverse: typeof traverseModule =
  "default" in traverseModule
    ? (traverseModule as unknown as { default: typeof traverseModule }).default
    : traverseModule;

const toLocation = (node: t.Node): ViewLocation | null =>
  node.loc
    ? {
        start: { line: node.loc.start.line, column: node.loc.start.column, index: node.start ?? 0 },
        end: { line: node.loc.end.line, column: node.loc.end.column, index: node.end ?? 0 },
      }
    : null;

const contains = (outer: ViewLocation | null, inner: ViewLocation): boolean =>
  outer !== null && outer.start.index <= inner.start.index && inner.end.index <= outer.end.index;

export const parseSource = (source: string): ParsedSource => {
  const parsed: ParsedSource = { references: [], declarators: [], attributes: [] };
  const visitIdentifier = (path: NodePath<t.Identifier | t.JSXIdentifier>): void => {
    const loc = toLocation(path.node);
    if (!loc || !path.isReferencedIdentifier()) return;
    const isCall = path.parentPath?.isCallExpression() && path.parentPath.node.callee === path.node;
    parsed.references.push({ name: path.node.name, loc, isCall: Boolean(isCall) });
  };
  const ast = parse(source, {
    sourceType: "module",
    plugins: ["typescript", "jsx"],
    errorRecovery: true,
  });
  traverse(ast, {
    Identifier: visitIdentifier,
    JSXIdentifier: visitIdentifier,
    VariableDeclarator(path) {
      const { id } = path.node;
      const loc = toLocation(path.node);
      if (!loc || id.type !== "ArrayPattern" || id.elements.length < 2) return;
      const [stateId, setterId] = id.elements;
      if (stateId?.type !== "Identifier" || setterId?.type !== "Identifier") return;
      parsed.declarators.push({ stateName: stateId.name, setterName: setterId.name, loc });
    },
    JSXAttribute(path) {
      const valueLoc = path.node.value && toLocation(path.node.value);
      const nameLoc = toLocation(path.node.name);
      if (valueLoc && nameLoc) parsed.attributes.push({ nameLoc, valueLoc });
    },
  });
  return parsed;
};

const getSetterNames = (
  declarators: StateDeclarator[],
  bindings: GraphBinding[],
): Map<number, string> => {
  const setters = new Map<number, string>();
  for (const declarator of declarators) {
    const binding = bindings.find(
      (candidate) =>
        candidate.name === declarator.stateName &&
        candidate.loc &&
        contains(declarator.loc, candidate.loc),
    );
    if (binding) setters.set(binding.id, declarator.setterName);
  }
  return setters;
};

const findEnclosingHandler = (handlers: GraphHandler[], loc: ViewLocation): GraphHandler | null =>
  handlers
    .filter((handler) => handler.loc && contains(handler.loc, loc))
    .sort(
      (a, b) => a.loc!.end.index - a.loc!.start.index - (b.loc!.end.index - b.loc!.start.index),
    )[0] ?? null;

interface GraphSink {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const getNodeId = (input: GraphInput, suffix: string): string => `${input.component}/${suffix}`;

const addWriteNode = (
  input: GraphInput,
  binding: GraphBinding,
  reference: Reference,
  index: number,
  sink: GraphSink,
): void => {
  const handler = findEnclosingHandler(input.handlers, reference.loc);
  const id = getNodeId(input, `write:${binding.id}:${index}`);
  sink.nodes.push({
    id,
    component: input.component,
    kind: "write",
    label: `writes ${binding.name}`,
    loc: reference.loc,
    bindingId: binding.id,
    handlerId: handler?.id,
  });
  sink.edges.push({ from: id, to: getNodeId(input, `binding:${binding.id}`), kind: "writes" });
  if (handler)
    sink.edges.push({ from: getNodeId(input, `handler:${handler.id}`), to: id, kind: "writes" });
};

const addReadNode = (
  input: GraphInput,
  binding: GraphBinding,
  reference: Reference,
  index: number,
  sink: GraphSink,
): void => {
  const handler = findEnclosingHandler(input.handlers, reference.loc);
  const id = getNodeId(input, `read:${binding.id}:${index}`);
  sink.nodes.push({
    id,
    component: input.component,
    kind: "read",
    label: handler ? `${binding.name} read by ${handler.label}` : `${binding.name} on screen`,
    loc: reference.loc,
    bindingId: binding.id,
    handlerId: handler?.id,
  });
  sink.edges.push({ from: getNodeId(input, `binding:${binding.id}`), to: id, kind: "reads" });
};

const addBindingNodes = (
  input: GraphInput,
  references: Reference[],
  setters: Map<number, string>,
  nodes: GraphNode[],
  edges: GraphEdge[],
): void => {
  const sink = { nodes, edges };
  for (const binding of input.bindings) {
    const { loc } = binding;
    if (!loc) continue;
    nodes.push({
      id: getNodeId(input, `binding:${binding.id}`),
      component: input.component,
      kind: "binding",
      label: `${binding.name} · ${binding.domain.join(" | ")}`,
      loc,
      bindingId: binding.id,
    });
    const setterName = setters.get(binding.id);
    references.forEach((reference, index) => {
      if (contains(loc, reference.loc)) return;
      if (reference.name === setterName) addWriteNode(input, binding, reference, index, sink);
      else if (reference.name === binding.name && !reference.isCall)
        addReadNode(input, binding, reference, index, sink);
    });
  }
};

const refineTriggerLocations = (
  attributes: JsxAttributeSite[],
  triggers: TriggerSite[],
): TriggerSite[] => {
  const refined = triggers.map((trigger) => ({ ...trigger }));
  for (const { nameLoc, valueLoc } of attributes)
    for (const trigger of refined)
      if (contains(valueLoc, trigger.loc) || contains(trigger.loc, valueLoc)) trigger.loc = nameLoc;
  return refined;
};

const getEventName = (propName: string): string =>
  propName.startsWith("on") ? propName.slice(2).toLowerCase() : propName;

const addHandlerNodes = (input: GraphInput, nodes: GraphNode[], edges: GraphEdge[]): void => {
  for (const handler of input.handlers) {
    if (!handler.loc) continue;
    nodes.push({
      id: getNodeId(input, `handler:${handler.id}`),
      component: input.component,
      kind: "handler",
      label: handler.label,
      loc: handler.loc,
      handlerId: handler.id,
    });
  }
  for (const trigger of input.triggers) {
    const id = getNodeId(input, `trigger:${trigger.handlerId}:${trigger.loc.start.index}`);
    nodes.push({
      id,
      component: input.component,
      kind: "trigger",
      label: getEventName(trigger.name),
      loc: trigger.loc,
      handlerId: trigger.handlerId,
    });
    edges.push({
      from: id,
      to: getNodeId(input, `handler:${trigger.handlerId}`),
      kind: "triggers",
    });
  }
};

const getConditionAnchor = (
  branch: ViewBranch,
  references: Reference[],
  bindings: GraphBinding[],
): ViewLocation | undefined => {
  const readIds = new Set(branch.readsBindingIds);
  const names = new Set(
    bindings.filter((binding) => readIds.has(binding.id)).map((binding) => binding.name),
  );
  return references
    .filter((reference) => names.has(reference.name) && contains(branch.loc, reference.loc))
    .sort((a, b) => a.loc.start.index - b.loc.start.index)[0]?.loc;
};

const addBranchNodes = (
  input: GraphInput,
  references: Reference[],
  nodes: GraphNode[],
  edges: GraphEdge[],
): void => {
  for (const branch of input.branches) {
    if (!branch.loc) continue;
    const branchNodeId = getNodeId(input, `branch:${branch.id}`);
    nodes.push({
      id: branchNodeId,
      component: input.component,
      kind: "branch",
      label: branch.test,
      loc: branch.loc,
      anchor: getConditionAnchor(branch, references, input.bindings),
      branchId: branch.id,
    });
    for (const bindingId of branch.readsBindingIds)
      edges.push({
        from: getNodeId(input, `binding:${bindingId}`),
        to: branchNodeId,
        kind: "decides",
      });
    for (const arm of ["consequent", "alternate"] as const) {
      const loc = branch[arm];
      if (!loc) continue;
      const id = getNodeId(input, `arm:${branch.id}:${arm}`);
      nodes.push({
        id,
        component: input.component,
        kind: "arm",
        label: arm === "consequent" ? `when ${branch.test}` : `when ${branch.negated}`,
        loc,
        branchId: branch.id,
        arm,
      });
      edges.push({ from: branchNodeId, to: id, kind: arm === "consequent" ? "shows" : "hides" });
    }
  }
};

export const buildCodeGraph = (input: GraphInput): CodeGraph => {
  const { parsed } = input;
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  addHandlerNodes(
    { ...input, triggers: refineTriggerLocations(parsed.attributes, input.triggers) },
    nodes,
    edges,
  );
  const references = parsed.references.filter((reference) =>
    contains(input.componentLoc, reference.loc),
  );
  addBindingNodes(
    input,
    references,
    getSetterNames(parsed.declarators, input.bindings),
    nodes,
    edges,
  );
  addBranchNodes(input, references, nodes, edges);
  const nodeIds = new Set(nodes.map((node) => node.id));
  return { nodes, edges: edges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to)) };
};
