import type { Handler, StateUpdate, SymbolicValue } from "../types";
import { getTriggerLabel } from "../labels/trigger-labels";
import { getValueLabels } from "./domains";
import {
  UNCHANGED,
  TRUE,
  and,
  collectPredicateVariables,
  ifThenElse,
  inValues,
} from "./predicates";
import { compileNextValue, forEachTerm } from "./terms";
import type { VariableTable } from "./variables";
import type {
  Action,
  ActionPhase,
  NextValue,
  Predicate,
  Term,
  Variable,
  VariableSource,
} from "./types";

type Settlement = "fulfilled" | "rejected";

const IDLE = "idle";
const PENDING = "pending";

const getSettlement = (guard: SymbolicValue): Settlement | null => {
  if (guard.kind === "Unknown" && guard.origin?.kind === "Settled") return guard.origin.settlement;
  if (guard.kind === "UnaryExpression" && guard.operator === "!") {
    const inner = getSettlement(guard.value);
    if (inner === "fulfilled") return "rejected";
    if (inner === "rejected") return "fulfilled";
  }
  return null;
};

const getUpdatePhase = (update: StateUpdate): ActionPhase => {
  if (!update.isAsync) return "call";
  return update.guards.map(getSettlement).find((outcome) => outcome !== null) ?? "fulfilled";
};

const compileUpdateGuard = (table: VariableTable, update: StateUpdate): Predicate =>
  and(
    update.guards
      .filter((guard) => getSettlement(guard) === null)
      .map((guard) => table.compile(guard)),
  );

const compileVariableWrite = (
  table: VariableTable,
  variable: Variable,
  updates: StateUpdate[],
): NextValue =>
  updates.reduce<NextValue>((previous, update) => {
    const guard = compileUpdateGuard(table, update);
    const next = compileNextValue(table, variable, update.value);
    return ifThenElse(guard, next, previous);
  }, UNCHANGED);

type Write = Action["writes"][number];

const compileWrites = (table: VariableTable, updates: StateUpdate[]): Write[] =>
  table.variables.flatMap((variable) => {
    const variableUpdates = updates.filter((update) => update.binding.id === variable.bindingId);
    if (variableUpdates.length === 0 || variable.source !== "state") return [];
    const next = compileVariableWrite(table, variable, variableUpdates);
    return next.kind === "Unchanged" ? [] : [{ variable: variable.name, next }];
  });

const getBindingIds = (updates: StateUpdate[]): number[] => [
  ...new Set(updates.map((update) => update.binding.id)),
];

const createPendingVariable = (handler: Handler): Variable => ({
  name: `pending_${handler.id}`,
  label: `${handler.id} pending`,
  source: "control",
  bindingKind: null,
  bindingId: null,
  inputBindingIds: [],
  path: [],
  domain: [
    { label: IDLE, abstract: { kind: "Exact", value: false } },
    { label: PENDING, abstract: { kind: "Exact", value: true } },
  ],
  initial: { kind: "Values", values: [IDLE] },
});

const createSnapshotVariable = (handler: Handler, variable: Variable): Variable => ({
  ...variable,
  name: `${variable.name}_at_${handler.id}`,
  label: `${variable.label} when ${handler.id} ran`,
  source: "control",
  bindingKind: null,
  bindingId: null,
  inputBindingIds: [],
  initial: { kind: "Values", values: getValueLabels(variable.domain).slice(0, 1) },
});

const renamePredicate = (predicate: Predicate, names: ReadonlyMap<string, string>): Predicate => {
  switch (predicate.kind) {
    case "In":
      return { ...predicate, variable: names.get(predicate.variable) ?? predicate.variable };
    case "Not":
      return { kind: "Not", operand: renamePredicate(predicate.operand, names) };
    case "And":
      return {
        kind: "And",
        conjuncts: predicate.conjuncts.map((part) => renamePredicate(part, names)),
      };
    case "Or":
      return {
        kind: "Or",
        disjuncts: predicate.disjuncts.map((part) => renamePredicate(part, names)),
      };
    default:
      return predicate;
  }
};

const renameTerm = (term: Term, names: ReadonlyMap<string, string>): Term => {
  switch (term.kind) {
    case "Read":
      return { kind: "Read", variable: names.get(term.variable) ?? term.variable };
    case "Plus":
    case "Minus":
      return {
        kind: term.kind,
        left: renameTerm(term.left, names),
        right: renameTerm(term.right, names),
      };
    case "Negative":
      return { kind: "Negative", operand: renameTerm(term.operand, names) };
    case "If":
      return {
        kind: "If",
        predicate: renamePredicate(term.predicate, names),
        consequent: renameTerm(term.consequent, names),
        alternate: renameTerm(term.alternate, names),
      };
    case "Either":
      return { kind: "Either", terms: term.terms.map((part) => renameTerm(part, names)) };
    case "Constant":
      return term;
  }
};

const renameNextValue = (next: NextValue, names: ReadonlyMap<string, string>): NextValue => {
  switch (next.kind) {
    case "Evaluate":
      return { kind: "Evaluate", term: renameTerm(next.term, names) };
    case "If":
      return {
        kind: "If",
        predicate: renamePredicate(next.predicate, names),
        consequent: renameNextValue(next.consequent, names),
        alternate: renameNextValue(next.alternate, names),
      };
    case "Copy":
      return { kind: "Copy", variable: names.get(next.variable) ?? next.variable };
    default:
      return next;
  }
};

const collectTermVariables = (root: Term, variables: Set<string>): void =>
  forEachTerm(root, (term) => {
    if (term.kind === "Read") variables.add(term.variable);
    if (term.kind === "If") collectPredicateVariables(term.predicate, variables);
  });

const collectNextValueVariables = (next: NextValue, variables: Set<string>): Set<string> => {
  if (next.kind === "Copy") variables.add(next.variable);
  if (next.kind === "Evaluate") collectTermVariables(next.term, variables);
  if (next.kind === "If") {
    collectPredicateVariables(next.predicate, variables);
    collectNextValueVariables(next.consequent, variables);
    collectNextValueVariables(next.alternate, variables);
  }
  return variables;
};

const isPending = (variable: Variable, value: string): Predicate =>
  inValues(variable.name, [value], getValueLabels(variable.domain));

const setPending = (variable: Variable, value: string): Write => ({
  variable: variable.name,
  next: { kind: "Values", values: [value] },
});

const RENDER_SOURCES: ReadonlySet<VariableSource> = new Set(["state", "input", "derived"]);

const takeSnapshots = (
  table: VariableTable,
  handler: Handler,
  tailWrites: Write[],
): Array<{ variable: Variable; snapshot: Variable }> => {
  const reads = tailWrites.reduce(
    (variables, write) => collectNextValueVariables(write.next, variables),
    new Set<string>(),
  );
  const snapshots = table.variables
    .filter((variable) => reads.has(variable.name) && RENDER_SOURCES.has(variable.source))
    .map((variable) => ({ variable, snapshot: createSnapshotVariable(handler, variable) }));
  for (const { snapshot } of snapshots) table.addVariable(snapshot);
  return snapshots;
};

export const compileHandlerActions = (
  table: VariableTable,
  handler: Handler,
  displayedBindingIds: ReadonlySet<number>,
  triggerLabel: string | undefined,
): Action[] => {
  if (handler.updates.length === 0) return [];
  const label = triggerLabel ?? getTriggerLabel(handler);
  const updatesByPhase = (phase: ActionPhase): StateUpdate[] =>
    handler.updates.filter((update) => getUpdatePhase(update) === phase);
  const hasRenderedWrite = (updates: StateUpdate[]): boolean =>
    updates.some((update) => displayedBindingIds.has(update.binding.id));
  const hasAsync = handler.updates.some((update) => update.isAsync);
  const pendingVariable = hasAsync ? createPendingVariable(handler) : null;
  if (pendingVariable) table.addVariable(pendingVariable);
  const guard = and(handler.guards.map((handlerGuard) => table.compile(handlerGuard)));
  const callUpdates = updatesByPhase("call");
  const call: Action = {
    name: handler.id,
    label,
    handlerId: handler.id,
    phase: "call",
    guard: pendingVariable ? and([guard, isPending(pendingVariable, IDLE)]) : guard,
    writes: [
      ...compileWrites(table, callUpdates),
      ...(pendingVariable ? [setPending(pendingVariable, PENDING)] : []),
    ],
    writtenBindingIds: getBindingIds(callUpdates),
    hasRenderedWrite: hasRenderedWrite(callUpdates),
    loc: handler.loc,
  };
  if (!pendingVariable) return [call];
  const fulfilledWrites = compileWrites(table, updatesByPhase("fulfilled"));
  const rejectedWrites = compileWrites(table, updatesByPhase("rejected"));
  const snapshots = takeSnapshots(table, handler, [...fulfilledWrites, ...rejectedWrites]);
  const snapshotNames = new Map(
    snapshots.map(({ variable, snapshot }) => [variable.name, snapshot.name]),
  );
  const settle = (phase: Settlement, writes: Write[]): Action => {
    const updates = updatesByPhase(phase);
    return {
      name: `${handler.id}_${phase}`,
      label: `${label} ${phase === "fulfilled" ? "resolves" : "rejects"}`,
      handlerId: handler.id,
      phase,
      guard: isPending(pendingVariable, PENDING),
      writes: [
        ...writes.map((write) => ({
          variable: write.variable,
          next: renameNextValue(write.next, snapshotNames),
        })),
        setPending(pendingVariable, IDLE),
        ...snapshots.map(({ snapshot }): Write => ({
          variable: snapshot.name,
          next: snapshot.initial,
        })),
      ],
      writtenBindingIds: getBindingIds(updates),
      hasRenderedWrite: hasRenderedWrite(updates),
      loc: handler.loc,
    };
  };
  return [
    {
      ...call,
      writes: [
        ...call.writes,
        ...snapshots.map(({ variable, snapshot }): Write => ({
          variable: snapshot.name,
          next: { kind: "Copy", variable: variable.name },
        })),
      ],
    },
    settle("fulfilled", fulfilledWrites),
    settle("rejected", rejectedWrites),
  ];
};

const describeInput = (variable: Variable): string => {
  switch (variable.bindingKind) {
    case "prop":
      return `parent changes ${variable.label}`;
    case "context":
      return `context changes ${variable.label}`;
    default:
      return `${variable.label} changes`;
  }
};

export const compileInputActions = (variables: Variable[]): Action[] =>
  variables
    .filter(
      (variable) =>
        (variable.source === "input" || variable.source === "opaque") && variable.domain.length > 1,
    )
    .map((variable) => ({
      name: `change_${variable.name}`,
      label: describeInput(variable),
      handlerId: null,
      phase: "input",
      guard: TRUE,
      writes: [
        {
          variable: variable.name,
          next: { kind: "Values", values: getValueLabels(variable.domain) },
        },
      ],
      writtenBindingIds: variable.bindingId === null ? [] : [variable.bindingId],
      hasRenderedWrite: false,
      loc: null,
    }));
