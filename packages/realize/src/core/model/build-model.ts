import type { Assertion, ComponentAnalysis, SymbolicValue } from "../types";
import { getValueLabels } from "./domains";
import { forEachRenderNode } from "../render/for-each-render-node";
import { forEachSymbolicValue } from "../values/for-each-symbolic-value";
import { getTestExpression } from "../values/get-test-expression";
import { foldBinary } from "../values/symbolic-values";
import { COMPARISONS } from "./abstract";
import { compileHandlerActions, compileInputActions } from "./actions";
import { and, collectPredicateVariables, not, or } from "./predicates";
import { evaluateInitialValues, forEachEvaluatedValue } from "./evaluate";
import { checkStateGraph, type StateGraph } from "./state-graph";
import { STATE_KINDS, createVariableTable, type VariableTable } from "./variables";
import { collectViews } from "./views";
import type {
  Action,
  Branch,
  BranchEdge,
  ComponentModel,
  Finding,
  Invariant,
  Variable,
} from "./types";

interface ScopedAssertion {
  assertion: Assertion;
  guards: SymbolicValue[];
  tests: SymbolicValue[];
}

const collectValueTests = (value: SymbolicValue, tests: SymbolicValue[]): void =>
  forEachEvaluatedValue(value, (node) => {
    if (node.kind === "Conditional") tests.push(getTestExpression(node));
    if (node.kind === "BinaryExpression" && COMPARISONS.has(node.operator)) tests.push(node);
  });

const getAssertionTests = (assertion: Assertion): SymbolicValue[] =>
  assertion.check.kind === "Condition"
    ? [assertion.check.test]
    : assertion.check.cases.flatMap((value) =>
        value.kind === "Literal"
          ? [foldBinary("===", assertion.subject, { kind: "Primitive", value: value.value })]
          : [],
      );

const readsOnlyState = (scoped: ScopedAssertion): boolean => {
  const kinds = new Set<string>();
  for (const value of [...scoped.guards, ...scoped.tests])
    forEachSymbolicValue(value, (node) => {
      if (node.kind === "Binding") kinds.add(node.binding.kind);
    });
  return [...kinds].every((kind) => STATE_KINDS.has(kind));
};

const collectAssertions = (analysis: ComponentAnalysis): ScopedAssertion[] =>
  [
    ...analysis.assertions.map((assertion) => ({
      assertion,
      guards: assertion.guards,
      tests: getAssertionTests(assertion),
    })),
    ...analysis.handlers.flatMap((handler) =>
      handler.assertions.map((assertion) => ({
        assertion,
        guards: [...handler.guards, ...assertion.guards],
        tests: getAssertionTests(assertion),
      })),
    ),
  ].filter(readsOnlyState);

const collectTests = (
  analysis: ComponentAnalysis,
  assertions: ScopedAssertion[],
): SymbolicValue[] => {
  const tests: SymbolicValue[] = [];
  forEachRenderNode(analysis.render, (node) => {
    if (node.kind === "Conditional") tests.push(getTestExpression(node));
  });
  for (const handler of analysis.handlers) {
    tests.push(...handler.guards);
    for (const update of handler.updates) {
      tests.push(...update.guards);
      collectValueTests(update.value, tests);
    }
  }
  for (const assertion of assertions) tests.push(...assertion.guards, ...assertion.tests);
  return tests;
};

const collectDisplayedBindingIds = (analysis: ComponentAnalysis): Set<number> => {
  const ids = new Set<number>();
  forEachSymbolicValue(analysis.render, (node) => {
    if (node.kind === "Binding") ids.add(node.binding.id);
  });
  const bindingsById = new Map(analysis.bindings.map((binding) => [binding.id, binding]));
  const pending = [...ids];
  for (let id = pending.pop(); id !== undefined; id = pending.pop())
    for (const place of bindingsById.get(id)?.inputPlaces ?? [])
      if (!ids.has(place.bindingId)) {
        ids.add(place.bindingId);
        pending.push(place.bindingId);
      }
  return ids;
};

const withDerivedWrites = (action: Action, derivedVariables: Variable[]): Action => {
  const writtenVariables = new Set(action.writes.map((write) => write.variable));
  const added = derivedVariables.filter(
    (variable) =>
      !writtenVariables.has(variable.name) &&
      variable.inputBindingIds.some((id) => action.writtenBindingIds.includes(id)),
  );
  if (added.length === 0) return action;
  return {
    ...action,
    writes: [
      ...action.writes,
      ...added.map((variable) => ({
        variable: variable.name,
        next: { kind: "Values" as const, values: getValueLabels(variable.domain) },
      })),
    ],
    writtenBindingIds: [
      ...new Set([
        ...action.writtenBindingIds,
        ...added.flatMap((variable) => variable.bindingId ?? []),
      ]),
    ],
  };
};

const compileInvariant = (
  table: VariableTable,
  scoped: ScopedAssertion,
  index: number,
): Invariant => ({
  name: `Assertion${index + 1}`,
  label: scoped.assertion.description,
  predicate: or([not(and(scoped.guards.map(table.compile))), or(scoped.tests.map(table.compile))]),
  loc: scoped.assertion.loc,
});

const isStateOnly = (invariant: Invariant, variables: Variable[]): boolean => {
  const sources = new Map(variables.map((variable) => [variable.name, variable.source]));
  return [...collectPredicateVariables(invariant.predicate, new Set())].every((variable) => {
    const source = sources.get(variable);
    return source === "state" || source === "control";
  });
};

const describeUnreachableEdge = (branch: Branch, edge: BranchEdge): string =>
  `${branch.label} is never ${edge === branch.consequent ? "true" : "false"} here`;

const describeStutteringAction = (action: Action): string =>
  action.phase === "rejected"
    ? `When ${action.label.replace(/ rejects$/, "")} fails, the render stays the same`
    : `${action.label} never changes the render`;

const collectFindings = (
  stateGraph: StateGraph,
  branches: Branch[],
  handlerActions: Action[],
  invariants: Invariant[],
  variables: Variable[],
): Finding[] => {
  const isEffective = (action: Action): boolean =>
    stateGraph.isActionEffective(action) ||
    (action.phase === "call" &&
      handlerActions.some(
        (settle) =>
          settle.handlerId === action.handlerId &&
          settle.phase !== "call" &&
          stateGraph.isActionEffective(settle),
      ));
  return [
    ...branches.flatMap((branch) =>
      [branch.consequent, branch.alternate]
        .filter((edge) => edge.isReachable === false)
        .map((edge): Finding => ({
          kind: "unreachable-branch",
          message: describeUnreachableEdge(branch, edge),
          loc: branch.loc,
          trace: null,
        })),
    ),
    ...handlerActions
      .filter((action) => !isEffective(action))
      .map((action): Finding => ({
        kind: "stuttering-action",
        message: describeStutteringAction(action),
        loc: action.loc,
        trace: stateGraph.findTrace(action.guard),
      })),
    ...invariants
      .filter((invariant) => isStateOnly(invariant, variables))
      .flatMap((invariant): Finding[] => {
        const trace = stateGraph.findTrace(not(invariant.predicate));
        return trace
          ? [
              {
                kind: "violated-assertion",
                message: `${invariant.label} can fail`,
                loc: invariant.loc,
                trace,
              },
            ]
          : [];
      }),
  ];
};

export const buildComponentModel = async (
  analysis: ComponentAnalysis,
  triggerLabels: ReadonlyMap<string, string> = new Map(),
): Promise<ComponentModel> => {
  const assertions = collectAssertions(analysis);
  const table = createVariableTable(analysis, collectTests(analysis, assertions));
  const { views, branches } = collectViews(
    table,
    analysis.render,
    analysis.file,
    analysis.branchEvaluations,
  );
  const invariants = assertions.map((assertion, index) =>
    compileInvariant(table, assertion, index),
  );
  const displayedBindingIds = collectDisplayedBindingIds(analysis);
  const compiledHandlerActions = analysis.handlers.flatMap((handler) =>
    compileHandlerActions(table, handler, displayedBindingIds, triggerLabels.get(handler.id)),
  );
  const derivedVariables = table.variables.filter((variable) => variable.source === "derived");
  const handlerActions = compiledHandlerActions.map((action) =>
    withDerivedWrites(action, derivedVariables),
  );
  const actions = [
    ...handlerActions,
    ...compileInputActions(table.variables).map((action) =>
      withDerivedWrites(action, derivedVariables),
    ),
  ];
  for (const variable of table.variables) {
    if (variable.source !== "state" || variable.bindingId === null) continue;
    const initial = analysis.bindings[variable.bindingId]?.initial;
    if (initial) variable.initial = evaluateInitialValues(table, variable, initial);
  }
  const stateGraph = await checkStateGraph(analysis.name, {
    variables: table.variables,
    actions,
    views,
    invariants,
  });
  const isComplete = !stateGraph.stateSpace.isTruncated;
  for (const branch of branches)
    for (const edge of [branch.consequent, branch.alternate])
      edge.isReachable = isComplete ? stateGraph.findTrace(edge.predicate) !== null : null;
  const findings = isComplete
    ? collectFindings(stateGraph, branches, handlerActions, invariants, table.variables)
    : [];
  return {
    variables: table.variables,
    actions,
    views,
    branches,
    invariants,
    stateSpace: stateGraph.stateSpace,
    findings,
  };
};
