import { MarkerDecisionError } from "../errors.js";
import { KEY_PLACEHOLDER, MARKER_NAMES } from "../materialize/markers.js";
import type { StaticRenderResult } from "../types.js";
import {
  collectGuardVariables,
  ELEMENT_SEGMENT,
  formatPredicate,
  formatVariable,
  type Guard,
  type InputVariable,
  mapGuardVariables,
  normalizePredicate,
  parseSymbolicCardinality,
  parseSymbolicPredicate,
  predicateGuards,
  type SymbolicCardinality,
  type SymbolicPredicate,
  type SymbolicVariable,
} from "./symbolic-tree.js";
import type {
  RuntimeFiberSnapshot,
  RuntimeSnapshot,
  SnapshotPropValue,
  SnapshotWorkTag,
} from "./snapshot.js";

// A pattern is the materialized fiber tree as the matcher consumes it:
// concrete nodes, text, alternatives, repeats, opaque subtrees and wildcards.
// Every branch and repeat is a decision variable; branches that share a
// predicate share the variable and are therefore always decided together, and
// every alternative carries the guard over symbolic inputs it is taken under.

export interface PatternFiber {
  kind: "fiber";
  tag: SnapshotWorkTag;
  name: string | null;
  key: string | null;
  children: PatternNode[];
}

export interface PatternText {
  kind: "text";
  text: string | null;
}

export interface PatternBranch {
  kind: "branch";
  variable: string;
  /** The materializer's id for this decision, which a replay pins it by. */
  decision: string;
  /** Decisions inside the alternatives were numbered in the enclosing scope (see `DecisionMarkerProps`). */
  sharesScope: boolean;
  reason: string;
  /** Where the source branched (`file:line:column`); null for branches the materializer introduces. */
  location: string | null;
  preferredIndex: number | null;
  /** One guard per alternative; exactly one holds under any assignment of the inputs. */
  guards: Guard[];
  inputs: InputVariable[];
  alternatives: PatternNode[][];
}

export interface RepeatBounds {
  min: number;
  /** null when the interpreter does not know how many items there are. */
  max: number | null;
}

export interface PatternRepeat {
  kind: "repeat";
  variable: string;
  /** The materializer's id for this decision, which a replay pins it by. */
  decision: string;
  location: string | null;
  /** The `length` the iteration count is equal to. */
  cardinality: SymbolicVariable;
  inputs: InputVariable[];
  /** Inputs used nowhere outside this repeat, so every iteration gets its own copy of them. */
  scopedInputs: string[];
  count: RepeatBounds;
  children: PatternNode[];
}

export interface PatternOpaque {
  kind: "opaque";
  name: string;
  /** Runtime names the external component may report; null when its export cannot be named statically (namespace member, default import, call result). */
  runtimeNames: string[] | null;
  key: string | null;
  reason: string;
  /** Children the application passed to the external component; matched somewhere inside its runtime subtree. */
  passedChildren: PatternNode[];
}

export interface PatternWildcard {
  kind: "wildcard";
  reason: string;
  /** The materializer did not render this subtree, so its states are missing from the enumeration. */
  isTruncated: boolean;
}

export type PatternNode =
  | PatternFiber
  | PatternText
  | PatternBranch
  | PatternRepeat
  | PatternOpaque
  | PatternWildcard;

const readString = (props: Record<string, SnapshotPropValue>, key: string): string | null => {
  const value = props[key];
  return typeof value === "string" ? value : null;
};

const UNNAMEABLE_IMPORT = /[.*()`]|^default$/;

const getOpaqueRuntimeNames = (
  displayName: string | null,
  importedName: string | null,
): string[] | null => {
  if (importedName === null || UNNAMEABLE_IMPORT.test(importedName)) return null;
  return [...new Set([importedName, displayName].filter((name) => name !== null))];
};

const readNumber = (props: Record<string, SnapshotPropValue>, key: string): number | null => {
  const value = props[key];
  return typeof value === "number" ? value : null;
};

const readKey = (fiber: RuntimeFiberSnapshot): string | null =>
  fiber.key === KEY_PLACEHOLDER ? null : fiber.key;

const readDecision = (fiber: RuntimeFiberSnapshot): string => {
  const decision = readString(fiber.props, "decision");
  if (decision === null) throw new MarkerDecisionError(fiber.name ?? fiber.tag);
  return decision;
};

const anonymousInput = (id: string, label: string, location: string | null): InputVariable => ({
  id,
  label,
  source: "unknown",
  location,
});

const anonymousCardinality = (input: InputVariable): SymbolicCardinality => ({
  variable: { input: input.id, path: [], measure: "length" },
  inputs: [input],
});

const anonymousChoice = (input: InputVariable): SymbolicPredicate => ({
  formula: null,
  choice: { input: input.id, path: [], measure: "choice" },
  inputs: [input],
});

const countInputUses = (nodes: PatternNode[], counts: Map<string, number>): void => {
  for (const node of nodes) {
    switch (node.kind) {
      case "fiber":
        countInputUses(node.children, counts);
        break;
      case "opaque":
        countInputUses(node.passedChildren, counts);
        break;
      case "branch":
        for (const input of node.inputs) counts.set(input.id, (counts.get(input.id) ?? 0) + 1);
        for (const alternative of node.alternatives) countInputUses(alternative, counts);
        break;
      case "repeat":
        for (const input of node.inputs) counts.set(input.id, (counts.get(input.id) ?? 0) + 1);
        countInputUses(node.children, counts);
        break;
      case "text":
      case "wildcard":
        break;
    }
  }
};

/** An input every use of which lies inside a repeat's body is that repeat's own: each iteration decides it afresh. */
const scopeRepeatInputs = (
  nodes: PatternNode[],
  totals: ReadonlyMap<string, number>,
): PatternNode[] =>
  nodes.map((node) => {
    switch (node.kind) {
      case "fiber":
        return { ...node, children: scopeRepeatInputs(node.children, totals) };
      case "opaque":
        return { ...node, passedChildren: scopeRepeatInputs(node.passedChildren, totals) };
      case "branch":
        return {
          ...node,
          alternatives: node.alternatives.map((alternative) =>
            scopeRepeatInputs(alternative, totals),
          ),
        };
      case "repeat": {
        const inside = new Map<string, number>();
        countInputUses(node.children, inside);
        return {
          ...node,
          scopedInputs: [...inside]
            .filter(([input, count]) => totals.get(input) === count)
            .map(([input]) => input),
          children: scopeRepeatInputs(node.children, totals),
        };
      }
      case "text":
      case "wildcard":
        return node;
    }
  });

class PatternReader {
  private anonymousDecisions = 0;
  private readonly inputIds = new Map<string, string>();

  read(fibers: RuntimeFiberSnapshot[]): PatternNode[] {
    return fibers.flatMap((fiber) => this.toPatternNode(fiber));
  }

  /** Inputs are numbered by first use in document order, so equal trees read to equal patterns whatever the evaluator numbered them. */
  private renameInput(id: string): string {
    let renamed = this.inputIds.get(id);
    if (renamed === undefined) {
      renamed = `#${this.inputIds.size + 1}`;
      this.inputIds.set(id, renamed);
    }
    return renamed;
  }

  private renameVariable(variable: SymbolicVariable): SymbolicVariable {
    return { ...variable, input: this.renameInput(variable.input) };
  }

  private renameInputs(inputs: InputVariable[]): InputVariable[] {
    return inputs.map((input) => ({ ...input, id: this.renameInput(input.id) }));
  }

  private renamePredicate(predicate: SymbolicPredicate): SymbolicPredicate {
    return {
      formula:
        predicate.formula &&
        mapGuardVariables(predicate.formula, (variable) => this.renameVariable(variable)),
      choice: predicate.choice && this.renameVariable(predicate.choice),
      inputs: this.renameInputs(predicate.inputs),
    };
  }

  private toBranch(fiber: RuntimeFiberSnapshot): PatternBranch {
    const serialized = readString(fiber.props, "predicate");
    const reason = readString(fiber.props, "reason") ?? "";
    const location = readString(fiber.props, "location");
    const preferredIndex = readNumber(fiber.props, "preferredIndex");
    const { predicate, isSwapped } = normalizePredicate(
      serialized === null
        ? anonymousChoice(anonymousInput(`branch#${++this.anonymousDecisions}`, reason, location))
        : this.renamePredicate(parseSymbolicPredicate(serialized)),
      fiber.children.length,
    );
    const alternatives = fiber.children.map((alternative) => this.read(alternative.children));
    return {
      kind: "branch",
      variable: formatPredicate(predicate),
      decision: readDecision(fiber),
      sharesScope: fiber.props.sharesScope === true,
      reason,
      location,
      preferredIndex: isSwapped && preferredIndex !== null ? 1 - preferredIndex : preferredIndex,
      guards: predicateGuards(predicate, alternatives.length),
      inputs: predicate.inputs,
      alternatives: isSwapped ? [alternatives[1], alternatives[0]] : alternatives,
    };
  }

  private toRepeat(fiber: RuntimeFiberSnapshot): PatternRepeat {
    const serialized = readString(fiber.props, "cardinality");
    const location = readString(fiber.props, "location");
    const parsed = serialized === null ? null : parseSymbolicCardinality(serialized);
    const cardinality = parsed
      ? { variable: this.renameVariable(parsed.variable), inputs: this.renameInputs(parsed.inputs) }
      : anonymousCardinality(
          anonymousInput(`repeat#${++this.anonymousDecisions}`, "repeated list", location),
        );
    return {
      kind: "repeat",
      variable: formatVariable(cardinality.variable),
      decision: readDecision(fiber),
      location,
      cardinality: cardinality.variable,
      inputs: cardinality.inputs,
      scopedInputs: [],
      count: {
        min: readNumber(fiber.props, "countMin") ?? 0,
        max: readNumber(fiber.props, "countMax"),
      },
      children: this.read(fiber.children),
    };
  }

  /** A pinned marker (a replay) rendered one alternative or count only; it reads as that content. */
  private toPatternNode(fiber: RuntimeFiberSnapshot): PatternNode[] {
    if (fiber.tag === "HostText") return [{ kind: "text", text: fiber.text }];
    switch (fiber.name) {
      case MARKER_NAMES.branch:
        return readNumber(fiber.props, "pinnedIndex") === null
          ? [this.toBranch(fiber)]
          : fiber.children.flatMap((alternative) => this.read(alternative.children));
      case MARKER_NAMES.repeat:
        return readNumber(fiber.props, "pinnedCount") === null
          ? [this.toRepeat(fiber)]
          : this.read(fiber.children);
      case MARKER_NAMES.opaque:
        return [
          {
            kind: "opaque",
            name: readString(fiber.props, "displayName") ?? "",
            runtimeNames: getOpaqueRuntimeNames(
              readString(fiber.props, "displayName"),
              readString(fiber.props, "importedName"),
            ),
            key: readKey(fiber),
            reason: readString(fiber.props, "reason") ?? "",
            passedChildren: this.read(fiber.children),
          },
        ];
      case MARKER_NAMES.unknown:
        return [
          {
            kind: "wildcard",
            reason: readString(fiber.props, "reason") ?? "",
            isTruncated: fiber.props.isTruncated === true,
          },
        ];
      case MARKER_NAMES.text:
        return [{ kind: "text", text: null }];
      case MARKER_NAMES.suspenseBoundary:
        return this.read(fiber.children);
      case MARKER_NAMES.suspended:
        return [];
      default:
        return [
          {
            kind: "fiber",
            tag: fiber.tag,
            name: fiber.name,
            key: readKey(fiber),
            children: this.read(fiber.children),
          },
        ];
    }
  }
}

/**
 * Reads the materialized fiber tree back into a pattern: marker components
 * become branches, repeats, opaque subtrees and wildcards; everything else is
 * a concrete fiber. A tree without markers is a fully concrete pattern.
 * Decision variables come from the markers, so equal trees read to equal
 * patterns.
 */
export const snapshotToPattern = (fibers: RuntimeFiberSnapshot[]): PatternNode[] => {
  const nodes = new PatternReader().read(fibers);
  const totals = new Map<string, number>();
  countInputUses(nodes, totals);
  return scopeRepeatInputs(nodes, totals);
};

export const getRenderPattern = (result: StaticRenderResult): PatternNode[] =>
  snapshotToPattern(result.snapshot.roots);

export const getSnapshotRootChildren = (snapshot: RuntimeSnapshot): PatternNode[] =>
  snapshotToPattern(snapshot.roots.flatMap((root) => root.children));

export const getRenderRootChildren = (result: StaticRenderResult): PatternNode[] =>
  getSnapshotRootChildren(result.snapshot);

const flattenPatternNode = (node: PatternNode, transparent: ReadonlySet<string>): PatternNode[] => {
  switch (node.kind) {
    case "fiber": {
      const children = flattenPatternFibers(node.children, transparent);
      if (transparent.has(node.name ?? node.tag)) return children;
      return [{ ...node, children }];
    }
    case "branch":
      return [
        {
          ...node,
          alternatives: node.alternatives.map((alternative) =>
            flattenPatternFibers(alternative, transparent),
          ),
        },
      ];
    case "repeat":
      return [{ ...node, children: flattenPatternFibers(node.children, transparent) }];
    case "opaque":
      return [{ ...node, passedChildren: flattenPatternFibers(node.passedChildren, transparent) }];
    case "text":
    case "wildcard":
      return [node];
  }
};

/** Splices out fibers named in `transparent` (anonymous ones by tag), promoting their children; used for framework wrappers synthesized on the static side. */
export const flattenPatternFibers = (
  nodes: PatternNode[],
  transparent: ReadonlySet<string>,
): PatternNode[] => {
  if (transparent.size === 0) return nodes;
  const result: PatternNode[] = [];
  for (const node of nodes) result.push(...flattenPatternNode(node, transparent));
  return result;
};

const decisionCache = new WeakMap<PatternNode, boolean>();

/**
 * Whether the subtree can match a runtime list in more than one way. A subtree
 * of only fibers, text and opaque nodes cannot, so nothing needs to backtrack
 * into it, enumerate it, or rescope it.
 */
export const hasPatternDecisions = (node: PatternNode): boolean => {
  const known = decisionCache.get(node);
  if (known !== undefined) return known;
  const result =
    node.kind === "fiber"
      ? node.children.some(hasPatternDecisions)
      : node.kind === "opaque"
        ? node.passedChildren.some(hasPatternDecisions)
        : node.kind !== "text";
  decisionCache.set(node, result);
  return result;
};

const addVariableCounts = (into: Map<string, number>, from: Map<string, number>): void => {
  for (const [variable, count] of from) into.set(variable, (into.get(variable) ?? 0) + count);
};

/** A decision is tied to its siblings through its own variable and through every input its guards read. */
const decisionKeys = (node: PatternBranch | PatternRepeat): string[] => [
  node.variable,
  ...node.inputs.map((input) => input.id),
];

const countDecision = (node: PatternBranch | PatternRepeat, counts: Map<string, number>): void => {
  for (const key of decisionKeys(node)) counts.set(key, (counts.get(key) ?? 0) + 1);
};

const countVariables = (nodes: PatternNode[], counts: Map<string, number>): void => {
  for (const node of nodes) {
    switch (node.kind) {
      case "fiber":
        countVariables(node.children, counts);
        break;
      case "opaque":
        countVariables(node.passedChildren, counts);
        break;
      case "branch":
        countDecision(node, counts);
        for (const alternative of node.alternatives) countVariables(alternative, counts);
        break;
      case "repeat":
        countDecision(node, counts);
        countVariables(node.children, counts);
        break;
      case "text":
      case "wildcard":
        break;
    }
  }
};

/**
 * Which fibers own every occurrence of the decision variables inside them: such a fiber's
 * children can be matched to completion on their own, without a continuation into its siblings.
 */
export class SelfContainedFiberIndex {
  private readonly totals = new Map<string, number>();
  private readonly selfContained = new Map<PatternFiber, boolean>();

  index(nodes: PatternNode[]): void {
    countVariables(nodes, this.totals);
    this.mark(nodes);
  }

  has(node: PatternFiber): boolean {
    return this.selfContained.get(node) ?? false;
  }

  private mark(nodes: PatternNode[]): Map<string, number> {
    const inside = new Map<string, number>();
    for (const node of nodes) {
      switch (node.kind) {
        case "fiber": {
          if (!hasPatternDecisions(node)) break;
          const own = this.mark(node.children);
          this.selfContained.set(
            node,
            [...own].every(([variable, count]) => this.totals.get(variable) === count),
          );
          addVariableCounts(inside, own);
          break;
        }
        case "opaque":
          addVariableCounts(inside, this.mark(node.passedChildren));
          break;
        case "branch":
          countDecision(node, inside);
          for (const alternative of node.alternatives)
            addVariableCounts(inside, this.mark(alternative));
          break;
        case "repeat":
          countDecision(node, inside);
          addVariableCounts(inside, this.mark(node.children));
          break;
        case "text":
        case "wildcard":
          break;
      }
    }
    return inside;
  }
}

const scopeInput = (input: InputVariable, scope: string): InputVariable => ({
  ...input,
  id: `${input.id}@${scope}`,
});

/**
 * Renames every decision variable inside `nodes` into `scope`, so one repeat
 * iteration decides independently of the next; the repeat's own inputs
 * (`scoped`) are renamed with them, while inputs shared with the rest of the
 * tree keep correlating across iterations.
 */
const scopePatternVariables = (
  nodes: PatternNode[],
  scope: string,
  scoped: ReadonlySet<string>,
): PatternNode[] => {
  const isIterationBound = (variable: SymbolicVariable): boolean =>
    scoped.has(variable.input) || variable.path.includes(ELEMENT_SEGMENT);
  const scopeVariable = (variable: SymbolicVariable): SymbolicVariable =>
    isIterationBound(variable) ? { ...variable, input: `${variable.input}@${scope}` } : variable;
  const scopeInputs = (inputs: InputVariable[], variables: SymbolicVariable[]): InputVariable[] => {
    const byId = new Map(inputs.map((input) => [input.id, input]));
    const used = new Map<string, InputVariable>();
    for (const variable of variables) {
      const original = byId.get(variable.input);
      if (!original) continue;
      const scopedVariable = scopeVariable(variable);
      used.set(
        scopedVariable.input,
        scopedVariable.input === variable.input ? original : scopeInput(original, scope),
      );
    }
    return [...used.values()];
  };
  return nodes.map((node) => {
    if (!hasPatternDecisions(node)) return node;
    switch (node.kind) {
      case "fiber":
        return { ...node, children: scopePatternVariables(node.children, scope, scoped) };
      case "opaque":
        return {
          ...node,
          passedChildren: scopePatternVariables(node.passedChildren, scope, scoped),
        };
      case "branch":
        return {
          ...node,
          variable: `${node.variable}@${scope}`,
          guards: node.guards.map((guard) => mapGuardVariables(guard, scopeVariable)),
          inputs: scopeInputs(
            node.inputs,
            node.guards.flatMap((guard) => collectGuardVariables(guard)),
          ),
          alternatives: node.alternatives.map((alternative) =>
            scopePatternVariables(alternative, scope, scoped),
          ),
        };
      case "repeat":
        return {
          ...node,
          variable: `${node.variable}@${scope}`,
          cardinality: scopeVariable(node.cardinality),
          inputs: scopeInputs(node.inputs, [node.cardinality]),
          scopedInputs: node.scopedInputs.map((input) =>
            scoped.has(input) ? `${input}@${scope}` : input,
          ),
          children: scopePatternVariables(node.children, scope, scoped),
        };
      case "text":
      case "wildcard":
        return node;
    }
  });
};

/** The body of one iteration of a repeat, deciding its own inputs in the scope of that iteration. */
export const scopeRepeatIteration = (node: PatternRepeat, iteration: number): PatternNode[] =>
  scopePatternVariables(
    node.children,
    `${node.variable}[${iteration}]`,
    new Set(node.scopedInputs),
  );

export const countPatternFibers = (node: PatternNode): number => {
  switch (node.kind) {
    case "fiber":
      return 1 + node.children.reduce((sum, child) => sum + countPatternFibers(child), 0);
    case "text":
      return 1;
    case "opaque":
      return 1 + node.passedChildren.reduce((sum, child) => sum + countPatternFibers(child), 0);
    case "branch":
      return Math.max(
        0,
        ...node.alternatives.map((alternative) =>
          alternative.reduce((sum, child) => sum + countPatternFibers(child), 0),
        ),
      );
    case "repeat":
      return node.children.reduce((sum, child) => sum + countPatternFibers(child), 0);
    case "wildcard":
      return 0;
  }
};

export const formatRepeatBounds = (count: RepeatBounds): string =>
  count.max === null ? `${count.min}..` : `${count.min}..${count.max}`;

const formatPatternNode = (node: PatternNode, depth: number): string[] => {
  const indent = "  ".repeat(depth);
  switch (node.kind) {
    case "fiber": {
      const key = node.key === null ? "" : ` key=${JSON.stringify(node.key)}`;
      return [
        `${indent}<${node.name ?? node.tag}>${key}`,
        ...node.children.flatMap((child) => formatPatternNode(child, depth + 1)),
      ];
    }
    case "text":
      return [`${indent}${node.text === null ? "#text(?)" : JSON.stringify(node.text)}`];
    case "branch":
      return [
        `${indent}?branch(${node.reason})${node.location === null ? "" : ` @ ${node.location}`}`,
        ...node.alternatives.flatMap((alternative, index) => [
          `${indent}  |${index}${node.preferredIndex === index ? " (preferred)" : ""}`,
          ...alternative.flatMap((child) => formatPatternNode(child, depth + 2)),
        ]),
      ];
    case "repeat":
      return [
        `${indent}*repeat(${formatRepeatBounds(node.count)})${node.location === null ? "" : ` @ ${node.location}`}`,
        ...node.children.flatMap((child) => formatPatternNode(child, depth + 1)),
      ];
    case "opaque": {
      const key = node.key === null ? "" : ` key=${JSON.stringify(node.key)}`;
      return [
        `${indent}<${node.name}>${key} (opaque: ${node.reason})`,
        ...node.passedChildren.flatMap((child) => formatPatternNode(child, depth + 1)),
      ];
    }
    case "wildcard":
      return [`${indent}?unknown(${node.reason})`];
  }
};

export const formatPattern = (nodes: PatternNode[]): string =>
  nodes.flatMap((node) => formatPatternNode(node, 0)).join("\n");
