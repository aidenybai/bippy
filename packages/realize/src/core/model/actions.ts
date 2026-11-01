import type { Handler, HandlerTrigger, StateUpdate, SymbolicValue } from "../types";
import { KEEP, TRUE, and, inCells } from "./conditions";
import { compileChoice } from "./evaluate";
import type { LaneTable } from "./lanes";
import type { Action, ActionPhase, Choice, Condition, Lane } from "./types";

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

const compileUpdateGuard = (table: LaneTable, update: StateUpdate): Condition =>
  and(
    update.guards
      .filter((guard) => getSettledOutcome(guard) === null)
      .map((guard) => table.compile(guard)),
  );

const compileLaneWrite = (table: LaneTable, lane: Lane, updates: StateUpdate[]): Choice =>
  updates.reduce<Choice>((previous, update) => {
    const guard = compileUpdateGuard(table, update);
    const choice = compileChoice(table, lane, update.value);
    return guard.kind === "True"
      ? choice
      : { kind: "If", condition: guard, then: choice, otherwise: previous };
  }, KEEP);

const compileWrites = (
  table: LaneTable,
  updates: StateUpdate[],
): Array<{ lane: string; choice: Choice }> =>
  table.lanes.flatMap((lane) => {
    const laneUpdates = updates.filter((update) => update.binding.id === lane.bindingId);
    if (laneUpdates.length === 0 || lane.source !== "state") return [];
    return [{ lane: lane.name, choice: compileLaneWrite(table, lane, laneUpdates) }];
  });

const getBindingIds = (updates: StateUpdate[]): number[] => [
  ...new Set(updates.map((update) => update.binding.id)),
];

const createPendingLane = (handler: Handler): Lane => ({
  name: `pending_${handler.id}`,
  label: `${handler.id} pending`,
  source: "pending",
  bindingKind: null,
  bindingId: null,
  inputBindingIds: [],
  path: [],
  cells: [
    { label: IDLE, value: { kind: "Exact", value: false } },
    { label: PENDING, value: { kind: "Exact", value: true } },
  ],
  initial: [IDLE],
});

const isPending = (lane: Lane, cell: string): Condition =>
  inCells(
    lane.name,
    [cell],
    lane.cells.map((pendingCell) => pendingCell.label),
  );

const setPending = (lane: Lane, cell: string): { lane: string; choice: Choice } => ({
  lane: lane.name,
  choice: { kind: "Cells", cells: [cell] },
});

export const compileHandlerActions = (
  table: LaneTable,
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
  const pendingLane = hasAsync ? createPendingLane(handler) : null;
  if (pendingLane) table.addLane(pendingLane);
  const guard = and(handler.guards.map((handlerGuard) => table.compile(handlerGuard)));
  const runUpdates = updatesByPhase("run");
  const run: Action = {
    name: handler.id,
    label,
    handlerId: handler.id,
    phase: "run",
    guard: pendingLane ? and([guard, isPending(pendingLane, IDLE)]) : guard,
    writes: [
      ...compileWrites(table, runUpdates),
      ...(pendingLane ? [setPending(pendingLane, PENDING)] : []),
    ],
    writtenBindingIds: getBindingIds(runUpdates),
    isVisible: isVisible(runUpdates),
    loc: handler.loc,
  };
  if (!pendingLane) return [run];
  const settle = (phase: "resolves" | "rejects"): Action => {
    const updates = updatesByPhase(phase);
    return {
      name: `${handler.id}_${phase}`,
      label: `${label}${PHASE_SUFFIX[phase]}`,
      handlerId: handler.id,
      phase,
      guard: isPending(pendingLane, PENDING),
      writes: [...compileWrites(table, updates), setPending(pendingLane, IDLE)],
      writtenBindingIds: getBindingIds(updates),
      isVisible: isVisible(updates),
      loc: handler.loc,
    };
  };
  return [run, settle("resolves"), settle("rejects")];
};

const describeInput = (lane: Lane): string => {
  switch (lane.bindingKind) {
    case "prop":
      return `parent changes ${lane.label}`;
    case "context":
      return `context changes ${lane.label}`;
    default:
      return `${lane.label} changes`;
  }
};

export const compileInputActions = (lanes: Lane[]): Action[] =>
  lanes
    .filter((lane) => (lane.source === "input" || lane.source === "test") && lane.cells.length > 1)
    .map((lane) => ({
      name: `change_${lane.name}`,
      label: describeInput(lane),
      handlerId: null,
      phase: "input",
      guard: TRUE,
      writes: [
        { lane: lane.name, choice: { kind: "Cells", cells: lane.cells.map((cell) => cell.label) } },
      ],
      writtenBindingIds: lane.bindingId === null ? [] : [lane.bindingId],
      isVisible: false,
      loc: null,
    }));
