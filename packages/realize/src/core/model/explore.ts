import { evaluatePredicate } from "./predicates";
import { NO_VIEW } from "./views";
import type {
  Action,
  NextValue,
  Predicate,
  StateSpace,
  Variable,
  View,
  ViewTransition,
  TraceStep,
} from "./types";

const MAX_STATES = 20_000;

const MAX_VARIABLES = 64;

const MAX_SUCCESSORS = 400_000;

const MAX_WRITE_COMBINATIONS = 20_000;

const MAX_TRANSITION_STEPS = 3;

const MAX_TRANSITION_SUCCESSORS = 50_000;

const INITIAL_CAPACITY = 64;

const EMPTY_SLOT = -1;

const NO_PARENT = -1;

const MASK_BITS = 32;

type Test =
  | { kind: "Constant"; value: boolean | null }
  | { kind: "In"; variable: number; allowed: Uint8Array }
  | { kind: "Bits"; variable: number; mask: number }
  | { kind: "Every"; variables: Int32Array; masks: Uint32Array }
  | { kind: "Not"; operand: Test }
  | { kind: "And"; parts: Test[] }
  | { kind: "Or"; parts: Test[] };

type Write =
  | { kind: "Unchanged" }
  | { kind: "Values"; values: number[] }
  | { kind: "If"; test: Test; consequent: Write; alternate: Write }
  | { kind: "Copy"; source: number; target: number; indexes: number[] };

interface CompiledAction {
  action: Action;
  guard: Test;
  variables: number[];
  writes: Write[];
}

export interface StateGraph {
  stateSpace: StateSpace;
  findTrace: (predicate: Predicate) => TraceStep[] | null;
  isActionEffective: (action: Action) => boolean;
  findTransition: (
    from: Predicate,
    to: Predicate,
    canTake: (action: Action, taken: Action[]) => boolean,
  ) => boolean | null;
}

const TRUE_TEST: Test = { kind: "Constant", value: true };

const FALSE_TEST: Test = { kind: "Constant", value: false };

const NULL_TEST: Test = { kind: "Constant", value: null };

const UNCHANGED_WRITE: Write = { kind: "Unchanged" };

const isInMask = (mask: number, value: number): boolean =>
  value < MASK_BITS && ((mask >>> value) & 1) === 1;

const toEvery = (parts: Test[]): Test => {
  const bits = parts.filter((part) => part.kind === "Bits");
  if (bits.length < 2) return { kind: "And", parts };
  const every: Test = {
    kind: "Every",
    variables: Int32Array.from(bits, (part) => part.variable),
    masks: Uint32Array.from(bits, (part) => part.mask),
  };
  const rest = parts.filter((part) => part.kind !== "Bits");
  return rest.length === 0 ? every : { kind: "And", parts: [every, ...rest] };
};

const runTest = (test: Test, states: Uint16Array, offset: number): boolean | null => {
  switch (test.kind) {
    case "Constant":
      return test.value;
    case "In":
      return test.allowed[states[offset + test.variable]] === 1;
    case "Bits":
      return isInMask(test.mask, states[offset + test.variable]);
    case "Every":
      for (let index = 0; index < test.variables.length; index++)
        if (!isInMask(test.masks[index], states[offset + test.variables[index]])) return false;
      return true;
    case "Not": {
      const inner = runTest(test.operand, states, offset);
      return inner === null ? null : !inner;
    }
    case "And": {
      let result: boolean | null = true;
      for (const part of test.parts) {
        const value = runTest(part, states, offset);
        if (value === false) return false;
        if (value === null) result = null;
      }
      return result;
    }
    case "Or": {
      let result: boolean | null = false;
      for (const part of test.parts) {
        const value = runTest(part, states, offset);
        if (value === true) return true;
        if (value === null) result = null;
      }
      return result;
    }
  }
};

const runWrite = (
  write: Write,
  states: Uint16Array,
  offset: number,
  variable: number,
): number[] => {
  switch (write.kind) {
    case "Unchanged":
      return [states[offset + variable]];
    case "Values":
      return write.values;
    case "If":
      return runTest(write.test, states, offset) === true
        ? runWrite(write.consequent, states, offset, variable)
        : runWrite(write.alternate, states, offset, variable);
    case "Copy":
      return [write.indexes[states[offset + write.source]]];
  }
};

const getLabelIds = (labels: string[]): number[] => {
  const ids = new Map<string, number>();
  return labels.map((label) => {
    const id = ids.get(label) ?? ids.size;
    ids.set(label, id);
    return id;
  });
};

export const exploreModel = (
  variables: Variable[],
  actions: Action[],
  views: View[],
): StateGraph => {
  const width = variables.length;
  const variableIndexes = new Map(variables.map((variable, index) => [variable.name, index]));
  const labels = variables.map((variable) => variable.domain.map((value) => value.label));
  const isObserved = variables.map((variable) => variable.source !== "control");

  const getValueIndex = (variable: number, label: string): number => {
    const index = labels[variable].indexOf(label);
    if (index !== -1) return index;
    labels[variable].push(label);
    return labels[variable].length - 1;
  };

  const compileTest = (predicate: Predicate): Test => {
    switch (predicate.kind) {
      case "True":
        return TRUE_TEST;
      case "False":
        return FALSE_TEST;
      case "In": {
        const variable = variableIndexes.get(predicate.variable);
        if (variable === undefined) return NULL_TEST;
        const indexes = predicate.values.map((label) => getValueIndex(variable, label));
        if (indexes.every((index) => index < MASK_BITS))
          return {
            kind: "Bits",
            variable,
            mask: indexes.reduce((mask, index) => (mask | (1 << index)) >>> 0, 0),
          };
        const allowed = new Uint8Array(Math.max(-1, ...indexes) + 1);
        for (const index of indexes) allowed[index] = 1;
        return { kind: "In", variable, allowed };
      }
      case "Not":
        return { kind: "Not", operand: compileTest(predicate.operand) };
      case "And":
        return toEvery(predicate.conjuncts.map(compileTest));
      case "Or":
        return { kind: "Or", parts: predicate.disjuncts.map(compileTest) };
    }
  };

  const copyWrites: Array<Extract<Write, { kind: "Copy" }>> = [];

  const compileWrite = (next: NextValue, variable: number): Write => {
    switch (next.kind) {
      case "Unchanged":
        return UNCHANGED_WRITE;
      case "Values":
        return {
          kind: "Values",
          values: next.values.map((label) => getValueIndex(variable, label)),
        };
      case "If":
        return {
          kind: "If",
          test: compileTest(next.predicate),
          consequent: compileWrite(next.consequent, variable),
          alternate: compileWrite(next.alternate, variable),
        };
      case "Copy": {
        const source = variableIndexes.get(next.variable);
        if (source === undefined) return UNCHANGED_WRITE;
        const write: Write = { kind: "Copy", source, target: variable, indexes: [] };
        copyWrites.push(write);
        return write;
      }
    }
  };

  const compiledActions = actions.map((action): CompiledAction => {
    const known = action.writes.flatMap((write) => {
      const variable = variableIndexes.get(write.variable);
      return variable === undefined
        ? []
        : [{ variable, write: compileWrite(write.next, variable) }];
    });
    return {
      action,
      guard: compileTest(action.guard),
      variables: known.map(({ variable }) => variable),
      writes: known.map(({ write }) => write),
    };
  });
  const viewTests = views.map((view) => compileTest(view.predicate));
  const viewLabels = [...views.map((view) => view.label), NO_VIEW];
  const viewLabelIds = getLabelIds(viewLabels);
  const viewCount = new Set(viewLabels).size;
  const actionLabelIds = getLabelIds(actions.map((action) => action.label));
  const actionLabelCount = new Set(actionLabelIds).size;

  const stride = Math.max(width, 1);
  let capacity = INITIAL_CAPACITY;
  let states = new Uint16Array(stride * capacity);
  let parents = new Int32Array(capacity);
  let takenActions = new Int32Array(capacity);
  let viewIndexes = new Int32Array(capacity);
  let slots = new Int32Array(capacity * 2).fill(EMPTY_SLOT);
  let stateCount = 0;
  let isTruncated = false;

  const getViewIndex = (buffer: Uint16Array, offset: number): number => {
    const index = viewTests.findIndex((test) => runTest(test, buffer, offset) === true);
    return index === -1 ? views.length : index;
  };

  const hashState = (buffer: Uint16Array, offset: number): number => {
    let hash = 0x811c9dc5;
    for (let index = 0; index < width; index++)
      hash = Math.imul(hash ^ buffer[offset + index], 0x01000193);
    return hash >>> 0;
  };

  const isSameState = (buffer: Uint16Array, offset: number, stateIndex: number): boolean => {
    const stateOffset = stateIndex * stride;
    for (let index = 0; index < width; index++)
      if (states[stateOffset + index] !== buffer[offset + index]) return false;
    return true;
  };

  const findSlot = (buffer: Uint16Array, offset: number): number => {
    const mask = slots.length - 1;
    let slot = hashState(buffer, offset) & mask;
    while (slots[slot] !== EMPTY_SLOT && !isSameState(buffer, offset, slots[slot]))
      slot = (slot + 1) & mask;
    return slot;
  };

  const findState = (buffer: Uint16Array): number => slots[findSlot(buffer, 0)];

  const grow = (): void => {
    capacity *= 2;
    const grownStates = new Uint16Array(stride * capacity);
    grownStates.set(states);
    states = grownStates;
    const grownParents = new Int32Array(capacity);
    grownParents.set(parents);
    parents = grownParents;
    const grownActions = new Int32Array(capacity);
    grownActions.set(takenActions);
    takenActions = grownActions;
    const grownViews = new Int32Array(capacity);
    grownViews.set(viewIndexes);
    viewIndexes = grownViews;
    slots = new Int32Array(capacity * 2).fill(EMPTY_SLOT);
    for (let stateIndex = 0; stateIndex < stateCount; stateIndex++)
      slots[findSlot(states, stateIndex * stride)] = stateIndex;
  };

  const addState = (buffer: Uint16Array, parent: number, action: number): number => {
    const slot = findSlot(buffer, 0);
    if (slots[slot] !== EMPTY_SLOT) return slots[slot];
    if (stateCount >= MAX_STATES) {
      isTruncated = true;
      return EMPTY_SLOT;
    }
    if (stateCount === capacity) {
      grow();
      return addState(buffer, parent, action);
    }
    states.set(buffer.subarray(0, width), stateCount * stride);
    parents[stateCount] = parent;
    takenActions[stateCount] = action;
    viewIndexes[stateCount] = getViewIndex(buffer, 0);
    slots[slot] = stateCount;
    return stateCount++;
  };

  const forEachSuccessor = (
    current: Uint16Array,
    compiled: CompiledAction,
    visit: (next: Uint16Array) => void,
  ): void => {
    if (runTest(compiled.guard, current, 0) !== true) return;
    const options = compiled.writes.map((write, index) =>
      runWrite(write, current, 0, compiled.variables[index]),
    );
    const next = current.slice();
    let count = 0;
    const walk = (index: number): boolean => {
      if (index === options.length) {
        count++;
        visit(next);
        return count < MAX_WRITE_COMBINATIONS;
      }
      const variable = compiled.variables[index];
      const previous = next[variable];
      for (const value of options[index]) {
        next[variable] = value;
        const isUnderLimit = walk(index + 1);
        if (!isUnderLimit) {
          next[variable] = previous;
          return false;
        }
      }
      next[variable] = previous;
      return true;
    };
    if (!walk(0)) isTruncated = true;
  };

  const initial = new Uint16Array(Math.max(width, 1));
  const initialOptions = variables.map((variable, index) =>
    variable.initial.map((label) => getValueIndex(index, label)),
  );
  for (const write of copyWrites)
    write.indexes = labels[write.source].map((label) => getValueIndex(write.target, label));
  let initialCount = 0;
  const enqueueInitial = (index: number): boolean => {
    if (index === width) {
      initialCount++;
      addState(initial, NO_PARENT, NO_PARENT);
      return initialCount < MAX_STATES;
    }
    for (const value of initialOptions[index]) {
      initial[index] = value;
      if (!enqueueInitial(index + 1)) return false;
    }
    return true;
  };
  if (width > MAX_VARIABLES || !enqueueInitial(0)) isTruncated = true;

  const effective = new Uint8Array(actions.length);
  const edgeKeys = new Set<number>();
  const edges: ViewTransition[] = [];
  const current = new Uint16Array(Math.max(width, 1));
  let successorCount = 0;

  for (
    let stateIndex = 0;
    stateIndex < stateCount && successorCount < MAX_SUCCESSORS;
    stateIndex++
  ) {
    current.set(states.subarray(stateIndex * stride, (stateIndex + 1) * stride));
    const fromView = viewIndexes[stateIndex];
    compiledActions.forEach((compiled, actionIndex) => {
      const { action } = compiled;
      forEachSuccessor(current, compiled, (next) => {
        successorCount++;
        const nextIndex = addState(next, stateIndex, actionIndex);
        let isChanged = action.hasRenderedWrite;
        for (let index = 0; !isChanged && index < width; index++)
          isChanged = isObserved[index] && next[index] !== current[index];
        if (!isChanged) return;
        effective[actionIndex] = 1;
        const toView = nextIndex === EMPTY_SLOT ? getViewIndex(next, 0) : viewIndexes[nextIndex];
        if (action.phase === "input" && toView === fromView) return;
        const edgeKey =
          (viewLabelIds[fromView] * actionLabelCount + actionLabelIds[actionIndex]) * viewCount +
          viewLabelIds[toView];
        if (edgeKeys.has(edgeKey)) return;
        edgeKeys.add(edgeKey);
        edges.push({
          from: viewLabels[fromView],
          to: viewLabels[toView],
          action: action.label,
          actionName: action.name,
          handlerId: action.handlerId,
          isAsync: action.phase === "fulfilled" || action.phase === "rejected",
          isInput: action.phase === "input",
        });
      });
    });
  }

  if (successorCount >= MAX_SUCCESSORS) isTruncated = true;
  const collectViews = (isIncluded: (stateIndex: number) => boolean): string[] => {
    const seen = new Uint8Array(viewCount);
    const collected: string[] = [];
    for (let stateIndex = 0; stateIndex < stateCount; stateIndex++) {
      const labelId = viewLabelIds[viewIndexes[stateIndex]];
      if (seen[labelId] === 1 || !isIncluded(stateIndex)) continue;
      seen[labelId] = 1;
      collected.push(viewLabels[viewIndexes[stateIndex]]);
    }
    return collected;
  };

  const toTrace = (stateIndex: number): TraceStep[] => {
    const steps: TraceStep[] = [];
    for (let index = stateIndex; index !== NO_PARENT; index = parents[index]) {
      const offset = index * stride;
      steps.push({
        action: takenActions[index] === NO_PARENT ? null : actions[takenActions[index]].name,
        state: Object.fromEntries(
          variables.map((variable, variableIndex) => [
            variable.name,
            labels[variableIndex][states[offset + variableIndex]],
          ]),
        ),
        view: viewLabels[viewIndexes[index]],
      });
    }
    return steps.reverse();
  };

  const findTrace = (predicate: Predicate): TraceStep[] | null => {
    const test = compileTest(predicate);
    for (let stateIndex = 0; stateIndex < stateCount; stateIndex++)
      if (runTest(test, states, stateIndex * stride) === true) return toTrace(stateIndex);
    return null;
  };

  const actionRadix = actions.length + 1;
  const isNumericKey = actionRadix ** MAX_TRANSITION_STEPS * MAX_STATES <= Number.MAX_SAFE_INTEGER;
  const getTakenKey = (stateIndex: number, taken: number[]): number | string => {
    const sorted = taken.toSorted((left, right) => left - right);
    if (!isNumericKey) return `${stateIndex}:${sorted.join(",")}`;
    return sorted.reduce((key, actionIndex) => key * actionRadix + actionIndex + 1, stateIndex);
  };

  const findTransition = (
    from: Predicate,
    to: Predicate,
    canTake: (action: Action, taken: Action[]) => boolean,
  ): boolean | null => {
    if (isTruncated) return null;
    const fromTest = compileTest(from);
    const toTest = compileTest(to);
    const node = new Uint16Array(Math.max(width, 1));
    let budget = MAX_TRANSITION_SUCCESSORS;
    for (let start = 0; start < stateCount; start++) {
      if (runTest(fromTest, states, start * stride) !== true) continue;
      let frontier = [{ stateIndex: start, taken: [] as number[] }];
      for (let step = 0; step < MAX_TRANSITION_STEPS && frontier.length > 0; step++) {
        const nextFrontier: typeof frontier = [];
        const seen = new Set<number | string>();
        let isFound = false;
        for (const { stateIndex, taken } of frontier) {
          node.set(states.subarray(stateIndex * stride, (stateIndex + 1) * stride));
          const takenActionsList = taken.map((actionIndex) => actions[actionIndex]);
          compiledActions.forEach((compiled, actionIndex) => {
            if (!canTake(compiled.action, takenActionsList)) return;
            forEachSuccessor(node, compiled, (next) => {
              budget--;
              if (runTest(toTest, next, 0) === true) isFound = true;
              const nextIndex = findState(next);
              if (nextIndex === EMPTY_SLOT) return;
              const nextTaken = [...taken, actionIndex];
              const key = getTakenKey(nextIndex, nextTaken);
              if (seen.has(key)) return;
              seen.add(key);
              nextFrontier.push({ stateIndex: nextIndex, taken: nextTaken });
            });
          });
        }
        if (isFound) return true;
        if (budget <= 0) return null;
        frontier = nextFrontier;
      }
    }
    return false;
  };

  const effectiveNames = new Set(
    actions.flatMap((action, index) => (effective[index] === 1 ? [action.name] : [])),
  );

  return {
    stateSpace: {
      stateCount,
      isTruncated,
      initialViews: collectViews((stateIndex) => parents[stateIndex] === NO_PARENT),
      reachableViews: collectViews(() => true),
      edges,
    },
    findTrace,
    isActionEffective: (action) => effectiveNames.has(action.name),
    findTransition,
  };
};

export const getViewLabel = (
  views: View[],
  valueOf: (variable: string) => string | undefined,
): string =>
  views.find((view) => evaluatePredicate(view.predicate, valueOf) === true)?.label ?? NO_VIEW;
