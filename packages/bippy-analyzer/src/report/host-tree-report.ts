import { evaluateGuard, type Guard } from "../symbolic/guards.js";
import {
  HostTreeReportError,
  type GuardedHostTreeInput,
  type GuardedHostTreeObservation,
  type GuardedHostTreeReport,
  type HostElementNode,
  type HostJsonObject,
  type HostJsonValue,
  type HostTreeCommit,
  type HostTreeDiagnostic,
  type HostTreeNode,
  type HostTextNode,
  type HostTreeReportLimits,
  type HostTreeReportOptions,
  type HostTreeSpecialization,
} from "./host-tree-types.js";

const invalid = (message: string): never => {
  throw new HostTreeReportError("invalid-input", message);
};
const exceeded = (name: string): never => {
  throw new HostTreeReportError(
    "budget-exceeded",
    `Host tree report exceeded ${name}; no partial result returned`,
  );
};
const getLimit = (value: number | undefined, fallback: number, name: string): number => {
  const limit = value ?? fallback;
  if (!Number.isSafeInteger(limit) || limit < 1) invalid(`Invalid ${name}`);
  return limit;
};
const getIdentifier = (value: string): string => {
  if (typeof value !== "string" || value.length < 1 || value.length > 128)
    invalid("Identifiers must contain 1–128 UTF-16 code units");
  return value;
};

export const createGuardedHostTreeReport = (
  inputs: readonly string[],
  observations: readonly GuardedHostTreeInput[],
  options: HostTreeReportOptions = {},
): GuardedHostTreeReport => {
  const limits: HostTreeReportLimits = Object.freeze({
    maxObservations: getLimit(options.maxObservations, 256, "maxObservations"),
    maxNodes: getLimit(options.maxNodes, 10000, "maxNodes"),
    maxEntries: getLimit(options.maxEntries, 100000, "maxEntries"),
    maxDepth: getLimit(options.maxDepth, 128, "maxDepth"),
    maxSnapshotCharacters: getLimit(
      options.maxSnapshotCharacters,
      1000000,
      "maxSnapshotCharacters",
    ),
  });
  if (limits.maxDepth > 128) invalid("maxDepth cannot exceed 128");
  if (inputs.length > 128) invalid("At most 128 Boolean inputs are supported");
  if (observations.length > limits.maxObservations) exceeded("maxObservations");
  const names = Array.from(inputs, getIdentifier);
  const declared = new Set(names);
  if (declared.size !== names.length) invalid("Duplicate input identifier");
  let entries = 0;
  let characters = 0;
  const tick = (depth: number) => {
    if (depth > limits.maxDepth) exceeded("maxDepth");
    if (++entries > limits.maxEntries) exceeded("maxEntries");
  };
  const getGuard = (guard: Guard, depth = 0): Guard => {
    tick(depth);
    if (!guard || typeof guard !== "object") return invalid("Invalid guard");
    switch (guard.kind) {
      case "constant":
        if (typeof guard.value !== "boolean") return invalid("Invalid Boolean constant");
        return Object.freeze({ kind: "constant", value: guard.value });
      case "truthy": {
        const variable = guard.variable;
        if (
          !variable ||
          !declared.has(variable.input) ||
          variable.measure !== "value" ||
          !Array.isArray(variable.path) ||
          variable.path.length !== 0
        )
          return invalid("Only declared Boolean inputs with empty paths are supported");
        const path: string[] = [];
        Object.freeze(path);
        return Object.freeze({
          kind: "truthy",
          variable: Object.freeze({ input: variable.input, measure: "value", path }),
        });
      }
      case "not":
        return Object.freeze({ kind: "not", operand: getGuard(guard.operand, depth + 1) });
      case "and": {
        if (!Array.isArray(guard.operands)) return invalid("Invalid guard operands");
        const operands = Array.from(guard.operands, (operand) => getGuard(operand, depth + 1));
        Object.freeze(operands);
        return Object.freeze({ kind: "and", operands });
      }
      default:
        return invalid("Unsupported guard kind");
    }
  };
  const getJson = (value: unknown, depth: number): HostJsonValue => {
    tick(depth);
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number") {
      if (!Number.isFinite(value) || Object.is(value, -0))
        return invalid("Snapshot numbers must be finite and not negative zero");
      return value;
    }
    if (Array.isArray(value)) return Object.freeze(value.map((item) => getJson(item, depth + 1)));
    if (typeof value !== "object") return invalid("Invalid snapshot data");
    return getObject(value, depth);
  };
  const getObject = (value: object, depth: number): HostJsonObject => {
    const result: Record<string, HostJsonValue> = Object.create(null);
    for (const name of Object.keys(value).sort())
      result[name] = getJson(Reflect.get(value, name), depth + 1);
    return Object.freeze(result);
  };
  const nodes: HostTreeNode[] = [];
  const interned = new Map<string, number>();
  const intern = (node: Omit<HostElementNode, "id"> | Omit<HostTextNode, "id">): number => {
    const key = JSON.stringify(node);
    const existing = interned.get(key);
    if (existing !== undefined) return existing;
    if (nodes.length >= limits.maxNodes) return exceeded("maxNodes");
    const id = nodes.length;
    nodes.push(Object.freeze({ id, ...node }));
    interned.set(key, id);
    return id;
  };
  const getNode = (value: unknown, depth: number): number => {
    tick(depth);
    if (typeof value === "string") return intern({ kind: "text", text: value });
    if (!value || typeof value !== "object" || Array.isArray(value))
      return invalid("Expected a host element or text node");
    const fields = Object.keys(value).sort();
    if (
      fields.length !== 3 ||
      fields[0] !== "children" ||
      fields[1] !== "props" ||
      fields[2] !== "type"
    )
      return invalid("Host elements require exactly type, props, and children");
    const type: unknown = Reflect.get(value, "type");
    const props: unknown = Reflect.get(value, "props");
    const children: unknown = Reflect.get(value, "children");
    if (typeof type !== "string" || !type) return invalid("Expected a host element type");
    if (!props || typeof props !== "object" || Array.isArray(props))
      return invalid("Expected serialized host props");
    if (children !== null && !Array.isArray(children))
      return invalid("Expected host children or null");
    tick(depth + 1);
    const copiedProps = getObject(props, depth + 1);
    const childIds =
      children === null ? null : Object.freeze(children.map((child) => getNode(child, depth + 1)));
    return intern({ kind: "element", type, props: copiedProps, children: childIds });
  };
  const ids = new Set<string>();
  const sorted = Array.from(observations, (observation) => {
    if (!observation || typeof observation !== "object") return invalid("Invalid observation");
    getIdentifier(observation.id);
    return observation;
  }).sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  const copied: GuardedHostTreeObservation[] = sorted.map((observation) => {
    const id = getIdentifier(observation.id);
    if (ids.has(id)) return invalid("Duplicate observation identifier");
    ids.add(id);
    const guard = getGuard(observation.guard);
    const outcome = observation.outcome;
    if (!outcome || typeof outcome !== "object") return invalid("Missing observation outcome");
    if (outcome.kind !== "commit") {
      if (
        !["throw", "unsupported", "incomplete", "engine-failure", "mismatch"].includes(
          outcome.kind,
        ) ||
        typeof outcome.message !== "string" ||
        (outcome.name !== undefined && typeof outcome.name !== "string")
      )
        return invalid("Invalid diagnostic outcome");
      characters += outcome.message.length + (outcome.name?.length ?? 0);
      if (characters > limits.maxSnapshotCharacters) exceeded("maxSnapshotCharacters");
      const diagnostic: HostTreeDiagnostic = Object.freeze({
        kind: outcome.kind,
        message: outcome.message,
        ...(outcome.name === undefined ? {} : { name: outcome.name }),
      });
      return Object.freeze({ id, guard, outcome: diagnostic });
    }
    if (typeof outcome.snapshot !== "string") return invalid("Expected a serialized host snapshot");
    characters += outcome.snapshot.length;
    if (characters > limits.maxSnapshotCharacters) exceeded("maxSnapshotCharacters");
    let value: unknown;
    try {
      value = JSON.parse(outcome.snapshot);
    } catch {
      return invalid("Invalid snapshot JSON");
    }
    const shape = value === null ? "empty" : Array.isArray(value) ? "array" : "single";
    const roots =
      value === null
        ? []
        : Array.isArray(value)
          ? value.map((child) => getNode(child, 0))
          : [getNode(value, 0)];
    const commit: HostTreeCommit = Object.freeze({
      kind: "commit",
      shape,
      roots: Object.freeze(roots),
    });
    return Object.freeze({ id, guard, outcome: commit });
  });
  return Object.freeze({
    scope: "guarded-host-tree-observations-v1",
    execution: "not-verified",
    coverage: "not-verified",
    inputs: Object.freeze(names),
    observations: Object.freeze(copied),
    nodes: Object.freeze(nodes),
    limits,
  });
};

export const specializeGuardedHostTree = (
  report: GuardedHostTreeReport,
  inputs: ReadonlyMap<string, boolean>,
): HostTreeSpecialization => {
  if (report.scope !== "guarded-host-tree-observations-v1")
    return invalid("Unsupported host tree report scope");
  if (inputs.size !== report.inputs.length)
    return invalid("Specialization requires exactly the declared Boolean inputs");
  const assignments = new Map<string, boolean>();
  for (const name of report.inputs) {
    const value = inputs.get(name);
    if (typeof value !== "boolean")
      return invalid("Specialization requires exactly the declared Boolean inputs");
    assignments.set(name, value);
  }
  const matches = report.observations.filter(
    (observation) => evaluateGuard(observation.guard, assignments) === true,
  );
  if (!matches.length) return Object.freeze({ kind: "uncovered" });
  if (matches.length > 1)
    return Object.freeze({
      kind: "ambiguous",
      observationIds: Object.freeze(matches.map((observation) => observation.id)),
    });
  const observation = matches[0];
  if (observation.outcome.kind !== "commit")
    return Object.freeze({
      kind: "selected",
      observationId: observation.id,
      outcome: observation.outcome,
    });
  let entries = 0;
  const expand = (id: number, depth: number): unknown => {
    if (depth > report.limits.maxDepth) return exceeded("maxDepth");
    if (++entries > report.limits.maxEntries) return exceeded("maxEntries");
    const node = report.nodes[id];
    if (!node || node.id !== id) return invalid("Invalid host node reference");
    return node.kind === "text"
      ? node.text
      : {
          type: node.type,
          props: node.props,
          children: node.children?.map((child) => expand(child, depth + 1)) ?? null,
        };
  };
  const roots = observation.outcome.roots.map((id) => expand(id, 0));
  const snapshot = JSON.stringify(
    observation.outcome.shape === "empty"
      ? null
      : observation.outcome.shape === "single"
        ? roots[0]
        : roots,
  );
  return Object.freeze({
    kind: "selected",
    observationId: observation.id,
    outcome: Object.freeze({ kind: "commit", snapshot }),
  });
};
