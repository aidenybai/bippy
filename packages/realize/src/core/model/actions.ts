import type { Handler, HandlerTrigger, StateUpdate, SymbolicValue } from "../types";
import { getValueLabels } from "./domains";
import { UNCHANGED, TRUE, and, ifThenElse, inValues } from "./predicates";
import { compileNextValue } from "./evaluate";
import type { VariableTable } from "./variables";
import type { Action, ActionPhase, NextValue, Predicate, Variable } from "./types";

type Outcome = "resolved" | "rejected";

const IDLE = "idle";
const PENDING = "pending";

const getSettledOutcome = (guard: SymbolicValue): Outcome | null => {
  if (guard.kind === "Unknown" && guard.origin?.kind === "Settled") return guard.origin.outcome;
  if (guard.kind === "UnaryExpression" && guard.operator === "!") {
    const inner = getSettledOutcome(guard.value);
    if (inner === "resolved") return "rejected";
    if (inner === "rejected") return "resolved";
  }
  return null;
};

const getUpdatePhase = (update: StateUpdate): ActionPhase => {
  if (!update.isAsync) return "run";
  const outcome = update.guards.map(getSettledOutcome).find((candidate) => candidate !== null);
  return outcome === "rejected" ? "rejects" : "resolves";
};

const formatTrigger = (trigger: HandlerTrigger): string => {
  switch (trigger.kind) {
    case "Event":
      return `${trigger.tag} ${trigger.event}`;
    case "Effect":
      return trigger.hookKind;
    case "Render":
      return "render";
  }
};

const PHASE_SUFFIX: Record<ActionPhase, string> = {
  run: "",
  resolves: " resolves",
  rejects: " rejects",
  input: "",
};

const compileUpdateGuard = (table: VariableTable, update: StateUpdate): Predicate =>
  and(
    update.guards
      .filter((guard) => getSettledOutcome(guard) === null)
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

const compileWrites = (
  table: VariableTable,
  updates: StateUpdate[],
): Array<{ variable: string; next: NextValue }> =>
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
  source: "pending",
  bindingKind: null,
  bindingId: null,
  inputBindingIds: [],
  path: [],
  domain: [
    { label: IDLE, abstract: { kind: "Exact", value: false } },
    { label: PENDING, abstract: { kind: "Exact", value: true } },
  ],
  initial: [IDLE],
});

const isPending = (variable: Variable, value: string): Predicate =>
  inValues(variable.name, [value], getValueLabels(variable.domain));

const setPending = (variable: Variable, value: string): { variable: string; next: NextValue } => ({
  variable: variable.name,
  next: { kind: "Values", values: [value] },
});

export const compileHandlerActions = (
  table: VariableTable,
  handler: Handler,
  displayedBindingIds: ReadonlySet<number>,
  triggerLabel: string | undefined,
): Action[] => {
  if (handler.updates.length === 0) return [];
  const label = triggerLabel ?? formatTrigger(handler.trigger);
  const updatesByPhase = (phase: ActionPhase): StateUpdate[] =>
    handler.updates.filter((update) => getUpdatePhase(update) === phase);
  const isVisible = (updates: StateUpdate[]): boolean =>
    updates.some((update) => displayedBindingIds.has(update.binding.id));
  const hasAsync = handler.updates.some((update) => update.isAsync);
  const pendingVariable = hasAsync ? createPendingVariable(handler) : null;
  if (pendingVariable) table.addVariable(pendingVariable);
  const guard = and(handler.guards.map((handlerGuard) => table.compile(handlerGuard)));
  const runUpdates = updatesByPhase("run");
  const run: Action = {
    name: handler.id,
    label,
    handlerId: handler.id,
    phase: "run",
    guard: pendingVariable ? and([guard, isPending(pendingVariable, IDLE)]) : guard,
    writes: [
      ...compileWrites(table, runUpdates),
      ...(pendingVariable ? [setPending(pendingVariable, PENDING)] : []),
    ],
    writtenBindingIds: getBindingIds(runUpdates),
    isVisible: isVisible(runUpdates),
    loc: handler.loc,
  };
  if (!pendingVariable) return [run];
  const settle = (phase: "resolves" | "rejects"): Action => {
    const updates = updatesByPhase(phase);
    return {
      name: `${handler.id}_${phase}`,
      label: `${label}${PHASE_SUFFIX[phase]}`,
      handlerId: handler.id,
      phase,
      guard: isPending(pendingVariable, PENDING),
      writes: [...compileWrites(table, updates), setPending(pendingVariable, IDLE)],
      writtenBindingIds: getBindingIds(updates),
      isVisible: isVisible(updates),
      loc: handler.loc,
    };
  };
  return [run, settle("resolves"), settle("rejects")];
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
        (variable.source === "input" || variable.source === "test") && variable.domain.length > 1,
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
      isVisible: false,
      loc: null,
    }));
