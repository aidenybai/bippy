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

interface GraphInput {
  idPrefix: string;
  source: string;
  componentLoc: ViewLocation | null;
  bindings: ViewBinding[];
  branches: ViewBranch[];
  handlers: ViewHandler[];
  triggers: TriggerSite[];
}

interface Reference {
  name: string;
  loc: ViewLocation;
  isCall: boolean;
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

const getSetterNames = (ast: t.File, bindings: ViewBinding[]): Map<number, string> => {
  const setters = new Map<number, string>();
  traverse(ast, {
    VariableDeclarator(path) {
      const { id } = path.node;
      if (id.type !== "ArrayPattern" || id.elements.length < 2) return;
      const [stateId, setterId] = id.elements;
      if (stateId?.type !== "Identifier" || setterId?.type !== "Identifier") return;
      const loc = toLocation(path.node);
      const binding = bindings.find(
        (candidate) =>
          candidate.name === stateId.name && candidate.loc && loc && contains(loc, candidate.loc),
      );
      if (binding) setters.set(binding.id, setterId.name);
    },
  });
  return setters;
};

const collectReferences = (ast: t.File, componentLoc: ViewLocation | null): Reference[] => {
  const references: Reference[] = [];
  const visit = (path: NodePath<t.Identifier | t.JSXIdentifier>): void => {
    const loc = toLocation(path.node);
    if (!loc || !contains(componentLoc, loc) || !path.isReferencedIdentifier()) return;
    const isCall = path.parentPath?.isCallExpression() && path.parentPath.node.callee === path.node;
    references.push({ name: path.node.name, loc, isCall: Boolean(isCall) });
  };
  traverse(ast, { Identifier: visit, JSXIdentifier: visit });
  return references;
};

const findEnclosingHandler = (handlers: ViewHandler[], loc: ViewLocation): ViewHandler | null =>
  handlers
    .filter((handler) => handler.loc && contains(handler.loc, loc))
    .sort(
      (a, b) => a.loc!.end.index - a.loc!.start.index - (b.loc!.end.index - b.loc!.start.index),
    )[0] ?? null;

interface GraphSink {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const addWriteNode = (
  input: GraphInput,
  binding: ViewBinding,
  reference: Reference,
  index: number,
  sink: GraphSink,
): void => {
  const handler = findEnclosingHandler(input.handlers, reference.loc);
  const id = `${input.idPrefix}write:${binding.id}:${index}`;
  sink.nodes.push({
    id,
    kind: "write",
    label: `writes ${binding.name}`,
    loc: reference.loc,
    bindingId: binding.id,
    handlerId: handler?.id,
  });
  sink.edges.push({ from: id, to: `${input.idPrefix}binding:${binding.id}`, kind: "writes" });
  if (handler)
    sink.edges.push({ from: `${input.idPrefix}handler:${handler.id}`, to: id, kind: "writes" });
};

const addReadNode = (
  input: GraphInput,
  binding: ViewBinding,
  reference: Reference,
  index: number,
  sink: GraphSink,
): void => {
  const handler = findEnclosingHandler(input.handlers, reference.loc);
  const id = `${input.idPrefix}read:${binding.id}:${index}`;
  sink.nodes.push({
    id,
    kind: "read",
    label: handler ? `${binding.name} read by ${handler.label}` : `${binding.name} on screen`,
    loc: reference.loc,
    bindingId: binding.id,
    handlerId: handler?.id,
  });
  sink.edges.push({ from: `${input.idPrefix}binding:${binding.id}`, to: id, kind: "reads" });
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
      id: `${input.idPrefix}binding:${binding.id}`,
      kind: "binding",
      label: `${binding.name} · ${binding.domain}`,
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

const refineTriggerLocations = (ast: t.File, triggers: TriggerSite[]): TriggerSite[] => {
  const refined = triggers.map((trigger) => ({ ...trigger }));
  traverse(ast, {
    JSXAttribute(path) {
      const valueLoc = path.node.value && toLocation(path.node.value);
      const nameLoc = toLocation(path.node.name);
      if (!valueLoc || !nameLoc) return;
      for (const trigger of refined)
        if (contains(valueLoc, trigger.loc) || contains(trigger.loc, valueLoc))
          trigger.loc = nameLoc;
    },
  });
  return refined;
};

const getEventName = (propName: string): string =>
  propName.startsWith("on") ? propName.slice(2).toLowerCase() : propName;

const addHandlerNodes = (input: GraphInput, nodes: GraphNode[], edges: GraphEdge[]): void => {
  for (const handler of input.handlers) {
    if (!handler.loc) continue;
    nodes.push({
      id: `${input.idPrefix}handler:${handler.id}`,
      kind: "handler",
      label: handler.label,
      loc: handler.loc,
      handlerId: handler.id,
    });
  }
  for (const trigger of input.triggers) {
    const id = `${input.idPrefix}trigger:${trigger.handlerId}:${trigger.loc.start.index}`;
    nodes.push({
      id,
      kind: "trigger",
      label: getEventName(trigger.name),
      loc: trigger.loc,
      handlerId: trigger.handlerId,
    });
    edges.push({ from: id, to: `${input.idPrefix}handler:${trigger.handlerId}`, kind: "triggers" });
  }
};

const getConditionAnchor = (
  branch: ViewBranch,
  references: Reference[],
  bindings: ViewBinding[],
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
    const branchNodeId = `${input.idPrefix}branch:${branch.id}`;
    nodes.push({
      id: branchNodeId,
      kind: "branch",
      label: branch.test,
      loc: branch.loc,
      anchor: getConditionAnchor(branch, references, input.bindings),
      branchId: branch.id,
    });
    for (const bindingId of branch.readsBindingIds)
      edges.push({
        from: `${input.idPrefix}binding:${bindingId}`,
        to: branchNodeId,
        kind: "decides",
      });
    for (const arm of ["consequent", "alternate"] as const) {
      const loc = branch[arm];
      if (!loc) continue;
      const id = `${input.idPrefix}arm:${branch.id}:${arm}`;
      nodes.push({
        id,
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
  const ast = parse(input.source, {
    sourceType: "module",
    plugins: ["typescript", "jsx"],
    errorRecovery: true,
  });
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  addHandlerNodes(
    { ...input, triggers: refineTriggerLocations(ast, input.triggers) },
    nodes,
    edges,
  );
  const references = collectReferences(ast, input.componentLoc);
  addBindingNodes(input, references, getSetterNames(ast, input.bindings), nodes, edges);
  addBranchNodes(input, references, nodes, edges);
  const nodeIds = new Set(nodes.map((node) => node.id));
  return { nodes, edges: edges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to)) };
};
