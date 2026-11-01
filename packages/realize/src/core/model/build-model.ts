import type { Claim, ComponentAnalysis, SymbolicValue } from "../types";
import { getValueLabels } from "./domains";
import { forEachRenderNode } from "../render/for-each-render-node";
import { forEachSymbolicValue } from "../values/for-each-symbolic-value";
import { getTestExpression } from "../values/get-test-expression";
import { foldBinary } from "../values/symbolic-values";
import { COMPARISONS } from "./abstract";
import { compileHandlerActions, compileInputActions } from "./actions";
import { and, collectPredicateVariables, not, or } from "./predicates";
import { evaluateInitialValues, forEachEvaluatedValue } from "./evaluate";
import { exploreModel, type ExploredModel } from "./explore";
import { STATE_KINDS, createVariableTable, type VariableTable } from "./variables";
import { collectViews } from "./views";
import type {
  Action,
  Branch,
  BranchEdge,
  ComponentModel,
  Finding,
  Property,
  Variable,
} from "./types";

interface ScopedClaim {
  claim: Claim;
  guards: SymbolicValue[];
  tests: SymbolicValue[];
}

const collectValueTests = (value: SymbolicValue, tests: SymbolicValue[]): void =>
  forEachEvaluatedValue(value, (node) => {
    if (node.kind === "Conditional") tests.push(getTestExpression(node));
    if (node.kind === "BinaryExpression" && COMPARISONS.has(node.operator)) tests.push(node);
  });

const getClaimTests = (claim: Claim): SymbolicValue[] =>
  claim.check.kind === "Condition"
    ? [claim.check.test]
    : claim.check.cases.flatMap((value) =>
        value.kind === "Literal"
          ? [foldBinary("===", claim.subject, { kind: "Primitive", value: value.value })]
          : [],
      );

const readsOnlyState = ({ guards, tests }: ScopedClaim): boolean => {
  let isStateOnly = true;
  for (const value of [...guards, ...tests])
    forEachSymbolicValue(value, (node) => {
      if (node.kind === "Binding" && !STATE_KINDS.has(node.binding.kind)) isStateOnly = false;
    });
  return isStateOnly;
};

const collectClaims = (analysis: ComponentAnalysis): ScopedClaim[] =>
  [
    ...analysis.claims.map((claim) => ({
      claim,
      guards: claim.guards,
      tests: getClaimTests(claim),
    })),
    ...analysis.handlers.flatMap((handler) =>
      handler.claims.map((claim) => ({
        claim,
        guards: [...handler.guards, ...claim.guards],
        tests: getClaimTests(claim),
      })),
    ),
  ].filter(readsOnlyState);

const collectTests = (analysis: ComponentAnalysis, claims: ScopedClaim[]): SymbolicValue[] => {
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
  for (const claim of claims) tests.push(...claim.guards, ...claim.tests);
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
  const written = new Set(action.writtenBindingIds);
  const writtenVariables = new Set(action.writes.map(({ variable }) => variable));
  const added: Variable[] = [];
  for (let isGrowing = true; isGrowing;) {
    isGrowing = false;
    for (const variable of derivedVariables) {
      if (writtenVariables.has(variable.name) || variable.bindingId === null) continue;
      if (!variable.inputBindingIds.some((id) => written.has(id))) continue;
      writtenVariables.add(variable.name);
      written.add(variable.bindingId);
      added.push(variable);
      isGrowing = true;
    }
  }
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
    writtenBindingIds: [...written],
  };
};

const compileProperty = (
  table: VariableTable,
  { claim, guards, tests }: ScopedClaim,
  index: number,
): Property => ({
  name: `Assertion${index + 1}`,
  label: claim.description,
  predicate: or([not(and(guards.map(table.compile))), or(tests.map(table.compile))]),
  loc: claim.loc,
});

const isStateOnly = (property: Property, variables: Variable[]): boolean => {
  const sources = new Map(variables.map((variable) => [variable.name, variable.source]));
  return [...collectPredicateVariables(property.predicate, new Set())].every((variable) => {
    const source = sources.get(variable);
    return source === "state" || source === "pending";
  });
};

const describeUnreachableEdge = (branch: Branch, edge: BranchEdge): string =>
  `${branch.test} is never ${edge === branch.consequent ? "true" : "false"} here`;

const describeStutteringAction = (action: Action): string =>
  action.phase === "rejects"
    ? `When ${action.label.replace(/ rejects$/, "")} fails, the render stays the same`
    : `${action.label} never changes the render`;

const collectFindings = (
  explored: ExploredModel,
  branches: Branch[],
  handlerActions: Action[],
  properties: Property[],
  variables: Variable[],
): Finding[] => {
  const isEffective = (action: Action): boolean =>
    explored.isActionEffective(action) ||
    (action.phase === "run" &&
      handlerActions.some(
        (settle) =>
          settle.handlerId === action.handlerId &&
          settle.phase !== "run" &&
          explored.isActionEffective(settle),
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
        trace: explored.findTrace(action.guard),
      })),
    ...properties
      .filter((property) => isStateOnly(property, variables))
      .flatMap((property): Finding[] => {
        const trace = explored.findTrace(not(property.predicate));
        return trace
          ? [
              {
                kind: "violated-assertion",
                message: `${property.label} can fail`,
                loc: property.loc,
                trace,
              },
            ]
          : [];
      }),
  ];
};

export const buildComponentModel = (
  analysis: ComponentAnalysis,
  triggerLabels: ReadonlyMap<string, string> = new Map(),
): ComponentModel => {
  const claims = collectClaims(analysis);
  const table = createVariableTable(analysis, collectTests(analysis, claims));
  const { views, branches } = collectViews(table, analysis.render, analysis.file);
  const properties = claims.map((claim, index) => compileProperty(table, claim, index));
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
  const bindingsById = new Map(analysis.bindings.map((binding) => [binding.id, binding]));
  for (const variable of table.variables) {
    if (variable.source !== "state" || variable.bindingId === null) continue;
    const initial = bindingsById.get(variable.bindingId)?.initial;
    if (initial) variable.initial = evaluateInitialValues(table, variable, initial);
  }
  const explored = exploreModel(table.variables, actions, views);
  const isComplete = !explored.stateSpace.isTruncated;
  for (const branch of branches)
    for (const edge of [branch.consequent, branch.alternate])
      edge.isReachable = isComplete ? explored.findTrace(edge.predicate) !== null : null;
  const findings = isComplete
    ? collectFindings(explored, branches, handlerActions, properties, table.variables)
    : [];
  return {
    variables: table.variables,
    actions,
    views,
    branches,
    properties,
    stateSpace: explored.stateSpace,
    findings,
  };
};
