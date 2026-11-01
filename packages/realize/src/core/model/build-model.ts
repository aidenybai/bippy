import type { Claim, ComponentAnalysis, SymbolicValue } from "../types";
import { forEachRenderNode } from "../render/for-each-render-node";
import { forEachSymbolicValue } from "../values/for-each-symbolic-value";
import { getTestExpression } from "../values/get-test-expression";
import { foldBinary } from "../values/symbolic-values";
import { COMPARISONS } from "./abstract";
import { compileHandlerActions, compileInputActions } from "./actions";
import { and, collectConditionLanes, not, or } from "./conditions";
import { evaluateInitialCells, forEachEvaluatedValue } from "./evaluate";
import { exploreModel, type ExploredModel } from "./explore";
import { STATE_KINDS, createLaneTable, type LaneTable } from "./lanes";
import { collectScreens } from "./screens";
import type { Action, Arm, ComponentModel, Finding, Lane, Property } from "./types";

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

const withDerivedWrites = (action: Action, derivedLanes: Lane[]): Action => {
  const written = new Set(action.writtenBindingIds);
  const writtenLanes = new Set(action.writes.map(({ lane }) => lane));
  const added: Lane[] = [];
  for (let isGrowing = true; isGrowing; ) {
    isGrowing = false;
    for (const lane of derivedLanes) {
      if (writtenLanes.has(lane.name) || lane.bindingId === null) continue;
      if (!lane.inputBindingIds.some((id) => written.has(id))) continue;
      writtenLanes.add(lane.name);
      written.add(lane.bindingId);
      added.push(lane);
      isGrowing = true;
    }
  }
  if (added.length === 0) return action;
  return {
    ...action,
    writes: [
      ...action.writes,
      ...added.map((lane) => ({
        lane: lane.name,
        choice: { kind: "Cells" as const, cells: lane.cells.map((cell) => cell.label) },
      })),
    ],
    writtenBindingIds: [...written],
  };
};

const compileProperty = (
  table: LaneTable,
  { claim, guards, tests }: ScopedClaim,
  index: number,
): Property => ({
  name: `Claim${index + 1}`,
  label: claim.description,
  condition: or([not(and(guards.map(table.compile))), or(tests.map(table.compile))]),
  loc: claim.loc,
});

const isStateOnly = (property: Property, lanes: Lane[]): boolean => {
  const sources = new Map(lanes.map((lane) => [lane.name, lane.source]));
  return [...collectConditionLanes(property.condition, new Set())].every((lane) => {
    const source = sources.get(lane);
    return source === "state" || source === "pending";
  });
};

const describeArm = (arm: Arm): string =>
  `${arm.test} is never ${arm.isTrueSide ? "true" : "false"} here`;

const describeSilentAction = (action: Action): string =>
  action.phase === "rejects"
    ? `When ${action.label.replace(/ rejects$/, "")} fails, nothing on screen changes`
    : `${action.label} never changes anything on screen`;

const collectFindings = (
  explored: ExploredModel,
  arms: Arm[],
  handlerActions: Action[],
  properties: Property[],
  lanes: Lane[],
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
    ...arms
      .filter((arm) => arm.isReachable === false)
      .map(
        (arm): Finding => ({
          kind: "unreachable-arm",
          message: describeArm(arm),
          loc: arm.loc,
          trace: null,
        }),
      ),
    ...handlerActions
      .filter((action) => !isEffective(action))
      .map(
        (action): Finding => ({
          kind: "silent-action",
          message: describeSilentAction(action),
          loc: action.loc,
          trace: explored.findWitness(action.guard),
        }),
      ),
    ...properties
      .filter((property) => isStateOnly(property, lanes))
      .flatMap((property): Finding[] => {
        const trace = explored.findWitness(not(property.condition));
        return trace
          ? [{ kind: "claim", message: `${property.label} can fail`, loc: property.loc, trace }]
          : [];
      }),
  ];
};

export const buildComponentModel = (
  analysis: ComponentAnalysis,
  triggerLabels: ReadonlyMap<string, string> = new Map(),
): ComponentModel => {
  const claims = collectClaims(analysis);
  const table = createLaneTable(analysis, collectTests(analysis, claims));
  const { screens, arms } = collectScreens(table, analysis.render, analysis.file);
  const properties = claims.map((claim, index) => compileProperty(table, claim, index));
  const displayedBindingIds = collectDisplayedBindingIds(analysis);
  const compiledHandlerActions = analysis.handlers.flatMap((handler) =>
    compileHandlerActions(table, handler, displayedBindingIds, triggerLabels.get(handler.id)),
  );
  const derivedLanes = table.lanes.filter((lane) => lane.source === "derived");
  const handlerActions = compiledHandlerActions.map((action) =>
    withDerivedWrites(action, derivedLanes),
  );
  const actions = [
    ...handlerActions,
    ...compileInputActions(table.lanes).map((action) => withDerivedWrites(action, derivedLanes)),
  ];
  const bindingsById = new Map(analysis.bindings.map((binding) => [binding.id, binding]));
  for (const lane of table.lanes) {
    if (lane.source !== "state" || lane.bindingId === null) continue;
    const initial = bindingsById.get(lane.bindingId)?.initial;
    if (initial) lane.initial = evaluateInitialCells(table, lane, initial);
  }
  const explored = exploreModel(table.lanes, actions, screens);
  const isComplete = !explored.exploration.isTruncated;
  for (const arm of arms) arm.isReachable = isComplete ? explored.findWitness(arm.condition) !== null : null;
  const findings = isComplete
    ? collectFindings(explored, arms, handlerActions, properties, table.lanes)
    : [];
  return {
    lanes: table.lanes,
    actions,
    screens,
    arms,
    properties,
    exploration: explored.exploration,
    findings,
  };
};
