import { describe, expect, it, vi } from "vite-plus/test";
import {
  applyReducerState,
  beginHookPass,
  commitHookPass,
  createHookFrame,
  createHookRenderAttempt,
  getQueuedState,
  escapeStateCell,
  mountAllEffects,
  mountEffect,
  nextMemoCell,
  nextStateCell,
  queueReducerAction,
  queueStateUpdate,
  runChangedEffects,
  runHookRender,
  unmountAllEffects,
  type EffectCall,
  type EffectRecord,
} from "../src/evaluate/hooks.js";
import { HeapJournal } from "../src/evaluate/heap-journal.js";
import { createPathPredicate, getAlternativeGuards } from "../src/evaluate/predicates.js";
import { getGuardedOutcomes } from "./helpers/differential-evaluator.js";
import { nativeFunction } from "../src/evaluate/stubs.js";
import {
  branchValue,
  getObjectProperty,
  listValue,
  objectValue,
  primitiveValue,
  UNDEFINED_VALUE,
} from "../src/evaluate/values.js";

const createEffect = (name: string, isLayout: boolean): EffectRecord => ({
  isLayout,
  callback: nativeFunction(name, () => UNDEFINED_VALUE),
  deps: listValue([]),
  cleanup: null,
});

const failure = new Error("abandoned render");

describe("hook render ownership", () => {
  it.each([false, true])(
    "preserves consumed external updates across retries (throws: %s)",
    (doesThrow) => {
      const frame = createHookFrame();
      const cell = nextStateCell(frame, "count", () => primitiveValue(0));
      const attempt = createHookRenderAttempt(frame);
      for (const incoming of [null, 2, 4]) {
        if (incoming !== null) {
          queueStateUpdate(frame, cell, primitiveValue(incoming), false);
          commitHookPass(frame);
        }
        runHookRender(
          frame,
          () => {
            beginHookPass(frame);
            queueStateUpdate(frame, cell, primitiveValue(1), false);
            commitHookPass(frame);
          },
          attempt,
        );
      }
      if (doesThrow) {
        commitHookPass(frame);
        expect(() =>
          runHookRender(
            frame,
            () => {
              beginHookPass(frame);
              queueStateUpdate(frame, cell, primitiveValue(9), false);
              throw failure;
            },
            attempt,
          ),
        ).toThrow(failure);
      } else attempt.discard();
      expect(cell.current).toEqual(primitiveValue(0));
      expect(getQueuedState(cell)).toEqual(primitiveValue(4));
      commitHookPass(frame);
      expect(cell.current).toEqual(primitiveValue(4));
      expect(frame.recordIncomingUpdates).toBeNull();
      const nextAttempt = createHookRenderAttempt(frame);
      attempt.discard();
      attempt.commit();
      expect(frame.recordIncomingUpdates).not.toBeNull();
      nextAttempt.commit();
      expect(frame.recordIncomingUpdates).toBeNull();
    },
  );

  it("rebases consumed reducer actions across multiple completed attempts", () => {
    const frame = createHookFrame();
    const cell = nextStateCell(frame, "count", () => primitiveValue(0));
    queueReducerAction(frame, cell, primitiveValue(2), false);
    const attempt = createHookRenderAttempt(frame);
    for (const incoming of [null, 4, 8]) {
      if (incoming !== null) {
        queueReducerAction(frame, cell, primitiveValue(incoming), false);
        commitHookPass(frame);
      }
      runHookRender(
        frame,
        () => {
          beginHookPass(frame);
          cell.pendingReducerActions = null;
          applyReducerState(frame, cell, primitiveValue(1));
          queueReducerAction(frame, cell, primitiveValue(1), false);
        },
        attempt,
      );
    }
    queueReducerAction(frame, cell, primitiveValue(16), false);
    attempt.discard();
    expect(cell.current).toEqual(primitiveValue(0));
    const actions = cell.pendingReducerActions;
    if (actions?.kind !== "list") throw new Error("Expected rebased reducer actions");
    expect(actions.items).toEqual([2, 4, 8, 16].map((value) => primitiveValue(value)));
  });

  it("rejects overlapping checkpoint owners without replacing the active owner", () => {
    const frame = createHookFrame();
    const attempt = createHookRenderAttempt(frame);
    const recordIncomingUpdates = frame.recordIncomingUpdates;
    expect(() => createHookRenderAttempt(frame)).toThrow("Hook frame already has a render attempt");
    expect(frame.recordIncomingUpdates).toBe(recordIncomingUpdates);
    attempt.discard();
    expect(frame.recordIncomingUpdates).toBeNull();
  });
  it.each(
    [1, 5].flatMap((queuedValue) =>
      [false, true].flatMap((isReversed) =>
        [false, true].map((doesRetry) => ({ queuedValue, isReversed, doesRetry })),
      ),
    ),
  )(
    "keeps no-update distinct from $queuedValue after discard (reverse: $isReversed, retry: $doesRetry)",
    ({ queuedValue, isReversed, doesRetry }) => {
      const frame = createHookFrame();
      const cell = nextStateCell(frame, "count", () => primitiveValue(0));
      const attempt = createHookRenderAttempt(frame);
      runHookRender(
        frame,
        () => {
          beginHookPass(frame);
          queueStateUpdate(frame, cell, primitiveValue(1), false);
          commitHookPass(frame);
        },
        attempt,
      );
      const journal = new HeapJournal();
      frame.recordUpdate = (updatedCell) => journal.recordStateUpdate(updatedCell);
      const selections = isReversed ? [false, true] : [true, false];
      const predicate = createPathPredicate("late state update", null);
      for (const isSelected of selections) {
        if (isSelected) queueStateUpdate(frame, cell, primitiveValue(queuedValue), false);
        journal.endPath();
      }
      journal.join("late state update", null, 0, predicate);
      frame.recordUpdate = null;
      if (doesRetry) {
        commitHookPass(frame);
        runHookRender(frame, () => beginHookPass(frame), attempt);
      }
      attempt.discard();
      const selection = branchValue(
        selections.map((isSelected) => primitiveValue(isSelected)),
        "late state update",
        null,
        0,
        predicate,
      );
      const conditions = selection.kind === "branch" && getAlternativeGuards(selection);
      if (!conditions) throw new Error("Missing state-update selection guards");
      const queued = getQueuedState(cell);
      commitHookPass(frame);
      selections.forEach((isSelected, index) => {
        const expected = [{ kind: "return", value: isSelected ? queuedValue : 0 }];
        expect(getGuardedOutcomes(queued, conditions.guards[index])).toEqual(expected);
        expect(getGuardedOutcomes(cell.current, conditions.guards[index])).toEqual(expected);
      });
    },
  );

  it.each([false, true])(
    "rebases incoming and later reducer actions (render-phase remainder: %s)",
    (hasRemainder) => {
      const frame = createHookFrame();
      const cell = nextStateCell(frame, "count", () => primitiveValue(0));
      queueReducerAction(frame, cell, primitiveValue(2), false);
      const attempt = createHookRenderAttempt(frame);
      runHookRender(
        frame,
        () => {
          beginHookPass(frame);
          cell.pendingReducerActions = null;
          applyReducerState(frame, cell, primitiveValue(2));
          if (hasRemainder) queueReducerAction(frame, cell, primitiveValue(1), false);
        },
        attempt,
      );
      queueReducerAction(frame, cell, primitiveValue(4), false);
      attempt.discard();
      expect(cell.current).toEqual(primitiveValue(0));
      const actions = cell.pendingReducerActions;
      if (actions?.kind !== "list") throw new Error("Expected the rebased reducer queue");
      expect(actions.items).toEqual([primitiveValue(2), primitiveValue(4)]);
    },
  );

  it("discards a completed attempt without losing later state and reducer updates", () => {
    const frame = createHookFrame();
    const state = nextStateCell(frame, "state", () => primitiveValue(0));
    const reducer = nextStateCell(frame, "reducer", () => primitiveValue(0));
    const attempt = createHookRenderAttempt(frame);
    runHookRender(
      frame,
      () => {
        beginHookPass(frame);
        queueStateUpdate(frame, state, primitiveValue(1), false);
        commitHookPass(frame);
        applyReducerState(frame, reducer, primitiveValue(2));
      },
      attempt,
    );
    queueStateUpdate(frame, state, primitiveValue(3), false);
    queueReducerAction(frame, reducer, primitiveValue(4), false);
    const actions = reducer.pendingReducerActions;
    attempt.discard();
    expect(state.current).toEqual(primitiveValue(0));
    expect(state.next).toEqual(primitiveValue(3));
    expect(reducer.current).toEqual(primitiveValue(0));
    expect(reducer.pendingReducerActions).toBe(actions);
  });

  it("does not retain an unconsumed render-phase update when discarding a completed attempt", () => {
    const frame = createHookFrame();
    const cell = nextStateCell(frame, "count", () => primitiveValue(0));
    const attempt = createHookRenderAttempt(frame);
    runHookRender(
      frame,
      () => {
        beginHookPass(frame);
        queueStateUpdate(frame, cell, primitiveValue(1), false);
      },
      attempt,
    );
    attempt.discard();
    expect(cell.next).toBeNull();
    expect(cell.current).toEqual(primitiveValue(0));
  });

  it("cannot discard an attempt after React accepted it", () => {
    const frame = createHookFrame();
    const cell = nextStateCell(frame, "count", () => primitiveValue(0));
    const attempt = createHookRenderAttempt(frame);
    runHookRender(
      frame,
      () => {
        beginHookPass(frame);
        queueStateUpdate(frame, cell, primitiveValue(2), false);
        commitHookPass(frame);
      },
      attempt,
    );
    attempt.commit();
    attempt.discard();
    expect(cell.current).toEqual(primitiveValue(2));
  });

  it("discards updates from every render-phase pass without losing an incoming update", () => {
    const frame = createHookFrame();
    const cell = nextStateCell(frame, "count", () => primitiveValue(0));
    queueStateUpdate(frame, cell, primitiveValue(2), false);
    commitHookPass(frame);
    expect(() =>
      runHookRender(frame, () => {
        beginHookPass(frame);
        queueStateUpdate(frame, cell, primitiveValue(3), false);
        commitHookPass(frame);
        beginHookPass(frame);
        queueStateUpdate(frame, cell, primitiveValue(4), false);
        throw failure;
      }),
    ).toThrow(failure);
    expect(frame.cells[0]).toBe(cell);
    expect(cell.current).toEqual(primitiveValue(2));
    expect(cell.next).toBeNull();
    expect(frame.isRendering).toBe(false);
  });

  it("retains incoming reducer actions but discards render-phase actions and reduced state", () => {
    const frame = createHookFrame();
    const cell = nextStateCell(frame, "count", () => primitiveValue(0));
    queueReducerAction(frame, cell, primitiveValue(2), false);
    const incoming = cell.pendingReducerActions;
    expect(() =>
      runHookRender(frame, () => {
        beginHookPass(frame);
        cell.pendingReducerActions = null;
        applyReducerState(frame, cell, primitiveValue(2));
        queueReducerAction(frame, cell, primitiveValue(5), false);
        throw failure;
      }),
    ).toThrow(failure);
    expect(cell.current).toEqual(primitiveValue(0));
    expect(cell.pendingReducerActions).toBe(incoming);
    expect(frame.hasRenderPhaseReducerUpdate).toBe(false);
  });

  it("restores memo identity without undoing writes through a shared ref", () => {
    const frame = createHookFrame();
    const reference = objectValue();
    const memo = objectValue();
    beginHookPass(frame);
    nextMemoCell(frame, null, () => reference);
    nextMemoCell(frame, listValue([primitiveValue(0)]), () => memo);
    frame.isRendering = false;
    expect(() =>
      runHookRender(frame, () => {
        beginHookPass(frame);
        nextMemoCell(frame, null, () => objectValue());
        reference.entries.push({ kind: "property", key: "count", value: primitiveValue(1) });
        nextMemoCell(frame, listValue([primitiveValue(1)]), () => objectValue());
        throw failure;
      }),
    ).toThrow(failure);
    beginHookPass(frame);
    const compute = vi.fn(() => objectValue());
    expect(nextMemoCell(frame, null, compute)).toBe(reference);
    expect(nextMemoCell(frame, listValue([primitiveValue(0)]), compute)).toBe(memo);
    expect(compute).not.toHaveBeenCalled();
    expect(getObjectProperty(reference, "count")).toEqual(primitiveValue(1));
  });

  it("keeps successful render metadata", () => {
    const frame = createHookFrame();
    const cell = nextStateCell(frame, "count", () => primitiveValue(0));
    const memo = objectValue();
    expect(
      runHookRender(frame, () => {
        beginHookPass(frame);
        queueStateUpdate(frame, cell, primitiveValue(1), false);
        commitHookPass(frame);
        nextMemoCell(frame, null, () => memo);
        return "finished";
      }),
    ).toBe("finished");
    expect(cell.current).toEqual(primitiveValue(1));
    expect(frame.memoCells[0].value).toBe(memo);
    expect(frame.isRendering).toBe(false);
  });

  it("does not undo external escape or deferred work registered by an abandoned render", () => {
    const frame = createHookFrame();
    const cell = nextStateCell(frame, "count", () => primitiveValue(0));
    expect(() =>
      runHookRender(frame, () => {
        beginHookPass(frame);
        queueStateUpdate(frame, cell, primitiveValue(3), true);
        escapeStateCell(frame, cell, null);
        throw failure;
      }),
    ).toThrow(failure);
    expect(cell.deferred).toEqual([primitiveValue(3)]);
    expect(cell.isEscaped).toBe(true);
  });

  it("cleans up committed records rather than registrations from an abandoned pass", () => {
    const frame = createHookFrame();
    const layout = createEffect("layout", true);
    const passive = createEffect("passive", false);
    frame.effects = [layout, passive];
    const committed = frame.effects;
    const layoutCleanup = nativeFunction("layout cleanup", () => UNDEFINED_VALUE);
    const passiveCleanup = nativeFunction("passive cleanup", () => UNDEFINED_VALUE);
    const call = vi
      .fn<EffectCall>(() => UNDEFINED_VALUE)
      .mockReturnValueOnce(layoutCleanup)
      .mockReturnValueOnce(passiveCleanup);
    mountAllEffects(committed, true, call);
    mountAllEffects(committed, false, call);
    beginHookPass(frame);
    frame.effects.push(
      createEffect("abandoned layout", true),
      createEffect("abandoned passive", false),
    );
    unmountAllEffects(committed, true, call);
    unmountAllEffects(committed, false, call);
    expect(call.mock.calls.map(([callback]) => callback)).toEqual([
      layout.callback,
      passive.callback,
      layoutCleanup,
      passiveCleanup,
    ]);
    expect(committed).toEqual([layout, passive]);
    expect(frame.effects).not.toBe(committed);
  });

  it("captures each native effect registration’s cleanup independently of mutable records", () => {
    const effect = createEffect("registered", false);
    const originalCleanup = nativeFunction("original cleanup", () => UNDEFINED_VALUE);
    const replacementCleanup = nativeFunction("replacement cleanup", () => UNDEFINED_VALUE);
    const call = vi.fn<EffectCall>(() => UNDEFINED_VALUE).mockReturnValueOnce(originalCleanup);
    const unmount = mountEffect(effect, call);
    effect.cleanup = replacementCleanup;
    unmount();
    expect(call.mock.calls.map(([callback]) => callback)).toEqual([
      effect.callback,
      originalCleanup,
    ]);
  });

  it("retains the old cleanup but reconnects the latest callback when dependencies are unchanged", () => {
    const original = createEffect("original", true);
    const updated = createEffect("updated", true);
    const cleanup = nativeFunction("original cleanup", () => UNDEFINED_VALUE);
    const call = vi.fn<EffectCall>(() => UNDEFINED_VALUE).mockReturnValueOnce(cleanup);
    mountAllEffects([original], true, call);
    const committed = [updated];
    runChangedEffects(committed, [original], true, call);
    expect(call).toHaveBeenCalledTimes(1);
    expect(updated.cleanup).toBe(cleanup);
    unmountAllEffects(committed, true, call);
    mountAllEffects(committed, true, call);
    expect(call.mock.calls.map(([callback]) => callback)).toEqual([
      original.callback,
      cleanup,
      updated.callback,
    ]);
  });
});
