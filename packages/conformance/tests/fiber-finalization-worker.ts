import assert from "node:assert/strict";
import type { Fiber } from "../../bippy/src/index.js";
import { createFiber } from "./fiber-fixture.js";

interface Registration {
  registry: object;
  target: WeakKey;
  token?: WeakKey;
  finalize: () => void;
}

interface UnmountObservation {
  live: boolean[];
  registrations: number[];
}

const NativeWeakRef = globalThis.WeakRef;
const NativeFinalizationRegistry = globalThis.FinalizationRegistry;
let nativeUnregisterChecks = 0;
const registrations = new Set<Registration>();
const collected = new Set<WeakKey>();
const dereferenceCounts = new Map<WeakKey, number>();

class ControlledWeakRef<Target extends WeakKey> implements WeakRef<Target> {
  readonly [Symbol.toStringTag] = "WeakRef";
  constructor(private target: Target) {}
  deref = (): Target | undefined => {
    dereferenceCounts.set(this.target, (dereferenceCounts.get(this.target) ?? 0) + 1);
    return collected.has(this.target) ? undefined : this.target;
  };
}

class ControlledFinalizationRegistry<HeldValue> implements FinalizationRegistry<HeldValue> {
  readonly [Symbol.toStringTag] = "FinalizationRegistry";
  private nativeRegistry?: FinalizationRegistry<HeldValue>;
  constructor(private callback: (heldValue: HeldValue) => void) {
    if (mode === "native") this.nativeRegistry = new NativeFinalizationRegistry(callback);
  }
  register = (target: WeakKey, heldValue: HeldValue, token?: WeakKey): void => {
    this.nativeRegistry?.register(target, heldValue, token);
    registrations.add({ registry: this, target, token, finalize: () => this.callback(heldValue) });
  };
  unregister = (token: WeakKey): boolean => {
    const nativeResult = this.nativeRegistry?.unregister(token);
    let didRemove = false;
    for (const registration of registrations) {
      if (registration.registry === this && registration.token === token) {
        registrations.delete(registration);
        didRemove = true;
      }
    }
    if (this.nativeRegistry) {
      assert.equal(nativeResult, didRemove);
      nativeUnregisterChecks++;
    }
    return didRemove;
  };
}

const [scenario, mode, direction, lookupOrder] = process.argv.slice(2);
const hasControlledWeakReferences = mode === "weak" || mode === "weak-only";
const hasFinalizer = mode === "weak" || mode === "strong" || mode === "native";
assert.ok(["weak", "weak-only", "strong", "neither", "native"].includes(mode));
Object.defineProperty(globalThis, "WeakRef", {
  configurable: true,
  writable: true,
  value:
    mode === "native" ? NativeWeakRef : hasControlledWeakReferences ? ControlledWeakRef : undefined,
});
Object.defineProperty(globalThis, "FinalizationRegistry", {
  configurable: true,
  writable: true,
  value: hasFinalizer ? ControlledFinalizationRegistry : undefined,
});

const getRegistrationCount = (target: WeakKey): number =>
  [...registrations].filter((registration) => registration.target === target).length;
const collect = (target: WeakKey): Array<() => void> => {
  collected.add(target);
  const pending = [...registrations].filter((registration) => registration.target === target);
  for (const registration of pending) registrations.delete(registration);
  return pending.map((registration) => registration.finalize);
};
const getLookupReads = (target: WeakKey, lookup: () => void): number => {
  const before = dereferenceCounts.get(target) ?? 0;
  lookup();
  return (dereferenceCounts.get(target) ?? 0) - before;
};

const { getFiberById, getFiberId, getRDTHook, instrument, setFiberId } =
  await import("../../bippy/src/index.js");
const target = {};
using _instrumentation = instrument({ target });
const hook = getRDTHook(undefined, target);

const runChurn = () => {
  const deletedIndex = Number(direction);
  assert.ok(deletedIndex === 0 || deletedIndex === 1);
  const retained = createFiber();
  const alternate = createFiber({ alternate: retained });
  retained.alternate = alternate;
  const control = createFiber();
  const handles = [retained, alternate, control];
  const getCounts = (): number[] => handles.map(getRegistrationCount);
  const expectedCount = hasFinalizer ? 1 : 0;
  const schedule = Array.from({ length: 64 }, (_, step) =>
    step % 4 === 0 ? null : (Math.floor(step / 2) % 5) + 2,
  );
  setFiberId(retained, 0);
  setFiberId(control, 1);
  let nextIdentifier = 2;
  let previousIdentifier = 0;
  let peakRegistrations = 0;
  const transcript: number[][] = [];
  for (const [step, explicitIdentifier] of schedule.entries()) {
    const expectedIdentifier = explicitIdentifier ?? nextIdentifier;
    nextIdentifier = Math.max(nextIdentifier, expectedIdentifier + 1);
    if (explicitIdentifier === null) setFiberId(retained);
    else setFiberId(retained, explicitIdentifier);
    assert.equal(getFiberId(retained), expectedIdentifier, `forward at step ${step}`);
    assert.equal(getFiberById(expectedIdentifier), retained, `reverse at step ${step}`);
    if (previousIdentifier !== expectedIdentifier)
      assert.equal(getFiberById(previousIdentifier), null);
    assert.equal(getFiberById(1), control);
    const counts = getCounts();
    assert.deepEqual(
      counts,
      [expectedCount, 0, expectedCount],
      `registration budget at step ${step}`,
    );
    peakRegistrations = Math.max(peakRegistrations, counts[0]);
    transcript.push([expectedIdentifier, ...counts]);
    previousIdentifier = expectedIdentifier;
  }
  const inheritedIdentifier = getFiberId(alternate);
  setFiberId(retained);
  const reassignedIdentifier = getFiberId(retained);
  assert.notEqual(inheritedIdentifier, reassignedIdentifier);
  assert.equal(getFiberById(inheritedIdentifier), alternate);
  assert.equal(getFiberById(reassignedIdentifier), retained);
  const observations: UnmountObservation[] = [];
  const failures: unknown[] = [];
  const failure = new Error("unmount observer failed");
  const originalConsoleError = console.error;
  console.error = (_message: unknown, error: unknown) => {
    failures.push(error);
    throw new Error("reporter failed");
  };
  try {
    using observer = instrument({
      target,
      onCommitFiberUnmount: () => {
        observations.push({
          live: [
            getFiberById(reassignedIdentifier) === retained,
            getFiberById(inheritedIdentifier) === alternate,
          ],
          registrations: getCounts(),
        });
        throw failure;
      },
    });
    hook.onCommitFiberUnmount(1, handles[deletedIndex]);
    assert.deepEqual(observations, [
      { live: [true, true], registrations: [expectedCount, expectedCount, expectedCount] },
    ]);
    assert.equal(failures.length, 1);
    assert.equal(failures[0], failure);
    observer();
    const afterUnmount = getCounts();
    assert.deepEqual(afterUnmount, [0, 0, expectedCount]);
    hook.onCommitFiberUnmount(1, handles[1 - deletedIndex]);
    assert.deepEqual(getCounts(), afterUnmount);
    assert.equal(getFiberById(inheritedIdentifier), null);
    assert.equal(getFiberById(reassignedIdentifier), null);
    const renewedIdentifier = getFiberId(retained);
    assert.ok(renewedIdentifier > reassignedIdentifier);
    assert.equal(getFiberById(renewedIdentifier), retained);
    assert.deepEqual(getCounts(), [expectedCount, 0, expectedCount]);
    hook.onCommitFiberUnmount(1, retained);
    hook.onCommitFiberUnmount(1, control);
    assert.equal(getFiberById(renewedIdentifier), null);
    assert.equal(getFiberById(0), null);
    assert.equal(getFiberById(1), null);
    assert.deepEqual(getCounts(), [0, 0, 0]);
    return {
      transcript,
      nativeChecked: nativeUnregisterChecks > 0,
      peakRegistrations,
      observations,
      reports: failures.length,
      afterUnmount,
      afterCleanup: getCounts(),
    };
  } finally {
    console.error = originalConsoleError;
  }
};

const runCollection = () => {
  assert.ok(hasControlledWeakReferences);
  assert.ok(direction === "forward" || direction === "reverse");
  assert.ok(lookupOrder === "first" || lookupOrder === "last");
  const isLookupFirst = lookupOrder === "first";
  const oldOwners = [createFiber(), createFiber()];
  const owners = [createFiber(), createFiber()];
  const control = createFiber();
  const replacement = createFiber();
  const queued = oldOwners.map((fiber, index) => {
    setFiberId(fiber, 41 + index);
    return collect(fiber);
  });
  const callbackOrder = direction === "forward" ? [0, 1] : [1, 0];
  const queuedCounts = [queued.flat().length];
  const transcript: Array<Array<string | null>> = [];
  const labels = new Map<Fiber, string>([
    [owners[0], "owner-0"],
    [owners[1], "owner-1"],
    [control, "control"],
    [replacement, "replacement"],
  ]);
  const verify = (expected: Array<string | null>): void => {
    const actual = [41, 42, 43].map((identifier) => {
      const fiber = getFiberById(identifier);
      return fiber === null ? null : (labels.get(fiber) ?? "wrong-fiber");
    });
    assert.deepEqual(actual, expected);
    transcript.push(actual);
  };
  owners.forEach((fiber, index) => setFiberId(fiber, 41 + index));
  setFiberId(control, 43);
  if (isLookupFirst) verify(["owner-0", "owner-1", "control"]);
  for (const index of callbackOrder) for (const finalize of queued[index]) finalize();
  verify(["owner-0", "owner-1", "control"]);
  const replacementCallbacks = collect(owners[0]);
  queuedCounts.push(replacementCallbacks.length);
  if (isLookupFirst) assert.equal(getFiberById(41), null);
  setFiberId(replacement, 41);
  for (const finalize of replacementCallbacks) finalize();
  verify(["replacement", "owner-1", "control"]);
  const deletionCallbacks = collect(owners[1]);
  queuedCounts.push(deletionCallbacks.length);
  const lookup = (): void => {
    assert.equal(getFiberById(42), null);
  };
  const beforeDrainReads = isLookupFirst ? getLookupReads(owners[1], lookup) : 0;
  for (const finalize of deletionCallbacks) finalize();
  const afterDrainReads = getLookupReads(owners[1], lookup);
  const repeatReads = getLookupReads(owners[1], lookup);
  assert.deepEqual(
    [beforeDrainReads, afterDrainReads, repeatReads],
    [isLookupFirst ? 1 : 0, !isLookupFirst && !hasFinalizer ? 1 : 0, 0],
  );
  verify(["replacement", null, "control"]);
  const beforeCleanup = [replacement, control].map(getRegistrationCount);
  assert.deepEqual(beforeCleanup, hasFinalizer ? [1, 1] : [0, 0]);
  hook.onCommitFiberUnmount(1, replacement);
  hook.onCommitFiberUnmount(1, control);
  verify([null, null, null]);
  const afterCleanup = [...oldOwners, ...owners, replacement, control].map(getRegistrationCount);
  assert.deepEqual(afterCleanup, [0, 0, 0, 0, 0, 0]);
  return {
    transcript,
    queuedCounts,
    lookupReads: [beforeDrainReads, afterDrainReads, repeatReads],
    beforeCleanup,
    afterCleanup,
  };
};

assert.ok(scenario === "churn" || scenario === "collection");
console.log(JSON.stringify(scenario === "churn" ? runChurn() : runCollection()));
