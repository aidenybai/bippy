import * as React from "react";
import {
  getFiberById,
  getFiberId,
  getLatestFiber,
  getRDTHook,
  instrument,
  type Fiber,
} from "bippy";
import { expect, it } from "vite-plus/test";
import { getFiberPreorder } from "./fiber-fixture.js";
import { createRenderHarness } from "./render-harness.js";

interface RecoveryState {
  value: number;
  epoch: number;
}

interface RecoveryProps {
  owner: number;
}

interface RecoveryProbeProps extends RecoveryProps {
  name: string;
  value: number;
}

interface RecoveryBoundaryProps extends RecoveryProps {
  children: React.ReactNode;
}

interface RecoveryBoundaryState {
  didFail: boolean;
}

interface RecoveryAttempt extends RecoveryProbeProps {
  fiber: Fiber;
}

const runRejectedTransition = async (failedOwner: number): Promise<string[]> => {
  const otherOwner = 1 - failedOwner;
  const transcript: string[] = [];
  const effects: string[] = [];
  const deletions: string[] = [];
  const failures: unknown[] = [];
  const failure = new Error("shared resource rejected");
  const pending = Promise.withResolvers<void>();
  let didReject = false;
  const record = (entries: string[], value: string): void => {
    entries.push(value);
    transcript.push(value);
  };
  const harnesses = [0, 1].map((owner) =>
    createRenderHarness({
      onCaughtError: (error) => {
        failures.push(error);
        record(effects, `caught:${owner}:${error === failure}`);
      },
    }),
  );
  const updates: React.Dispatch<React.SetStateAction<RecoveryState>>[] = [];
  const attempts: RecoveryAttempt[] = [];
  const renderer = [...getRDTHook().renderers.values()].find(
    (candidate) => candidate.rendererPackageName === "react-dom",
  );
  if (!renderer?.getCurrentFiber) throw new Error("Missing rendering oracle");
  const getRenderingFiber = renderer.getCurrentFiber;
  const Probe = ({ owner, name, value }: RecoveryProbeProps) => {
    const fiber = getRenderingFiber();
    if (!fiber) throw new Error("Missing rendering fiber");
    attempts.push({ owner, name, value, fiber });
    React.useLayoutEffect(() => {
      record(effects, `layout-on:${owner}:${name}:${value}`);
      return () => {
        record(effects, `layout-off:${owner}:${name}:${value}`);
      };
    }, [owner, name, value]);
    React.useEffect(() => {
      record(effects, `passive-on:${owner}:${name}:${value}`);
      return () => {
        record(effects, `passive-off:${owner}:${name}:${value}`);
      };
    }, [owner, name, value]);
    if (name === "primary" && value === 1) throw didReject ? failure : pending.promise;
    return (
      <span>
        {name}:{value}
      </span>
    );
  };
  class Boundary extends React.Component<RecoveryBoundaryProps, RecoveryBoundaryState> {
    state = { didFail: false };
    static getDerivedStateFromError = (): RecoveryBoundaryState => ({ didFail: true });
    componentDidCatch = (error: Error): void => {
      record(effects, `boundary:${this.props.owner}:${error === failure}`);
    };
    render = () =>
      this.state.didFail ? (
        <Probe owner={this.props.owner} name="error" value={-1} />
      ) : (
        this.props.children
      );
  }
  const App = ({ owner }: RecoveryProps) => {
    const [state, update] = React.useState<RecoveryState>({ value: 0, epoch: 0 });
    updates[owner] = update;
    return (
      <Boundary key={state.epoch} owner={owner}>
        <React.Suspense fallback={<Probe owner={owner} name="loading" value={-1} />}>
          <Probe owner={owner} name="primary" value={state.value} />
        </React.Suspense>
      </Boundary>
    );
  };
  using _unsubscribe = instrument({
    onCommitFiberUnmount: (_rendererId, fiber) => {
      if (fiber.type === Probe)
        record(deletions, `delete:${fiber.memoizedProps.owner}:${fiber.memoizedProps.name}`);
    },
  });
  const getProbe = (owner: number, name: string): Fiber => {
    const fiber = getFiberPreorder(harnesses[owner].getRoot().current).find(
      (candidate) => candidate.type === Probe && candidate.memoizedProps.name === name,
    );
    if (!fiber) throw new Error(`Missing ${owner}:${name}`);
    return fiber;
  };
  for (const [owner, harness] of harnesses.entries()) {
    await harness.render(<App owner={owner} />);
    expect(effects.splice(0)).toEqual([
      `layout-on:${owner}:primary:0`,
      `passive-on:${owner}:primary:0`,
    ]);
  }
  const firstFibers = harnesses.map((_, owner) => getProbe(owner, "primary"));
  const identifiers = firstFibers.map(getFiberId);
  const firstRoots = harnesses.map((harness) => harness.getRoot().current);
  await React.act(async () =>
    React.startTransition(() => {
      for (const update of updates) update({ value: 1, epoch: 0 });
    }),
  );
  for (const owner of [0, 1]) {
    const attempt = attempts.find(
      (candidate) => candidate.owner === owner && candidate.value === 1,
    );
    if (!attempt) throw new Error(`Root ${owner} never suspended`);
    expect(attempt.fiber.alternate === firstFibers[owner]).toBe(true);
    expect(getLatestFiber(attempt.fiber) === firstFibers[owner]).toBe(true);
    expect(getFiberId(attempt.fiber)).toBe(identifiers[owner]);
    expect(harnesses[owner].getRoot().current === firstRoots[owner]).toBe(true);
  }
  expect(effects).toEqual([]);
  expect(deletions).toEqual([]);
  await React.act(async () => updates[otherOwner]({ value: 2, epoch: 0 }));
  expect(effects.splice(0)).toEqual([
    `layout-off:${otherOwner}:primary:0`,
    `layout-on:${otherOwner}:primary:2`,
    `passive-off:${otherOwner}:primary:0`,
    `passive-on:${otherOwner}:primary:2`,
  ]);
  const surviving = getProbe(otherOwner, "primary");
  expect(getFiberById(identifiers[otherOwner]) === surviving).toBe(true);
  await React.act(async () => {
    didReject = true;
    pending.reject(failure);
    await pending.promise.catch(() => {});
  });
  expect(effects.splice(0)).toEqual([
    `layout-off:${failedOwner}:primary:0`,
    `layout-on:${failedOwner}:error:-1`,
    `caught:${failedOwner}:true`,
    `boundary:${failedOwner}:true`,
    `passive-off:${failedOwner}:primary:0`,
    `passive-on:${failedOwner}:error:-1`,
  ]);
  expect(deletions.splice(0)).toEqual([`delete:${failedOwner}:primary`]);
  expect(failures.map((error) => error === failure)).toEqual([true]);
  expect(getFiberById(identifiers[failedOwner])).toBeNull();
  expect(getFiberById(identifiers[otherOwner]) === surviving).toBe(true);
  expect(harnesses[otherOwner].container.textContent).toBe("primary:2");
  expect(harnesses[failedOwner].container.textContent).toBe("error:-1");
  const errorIdentifier = getFiberId(getProbe(failedOwner, "error"));
  await React.act(async () => updates[failedOwner]({ value: 3, epoch: 1 }));
  expect(effects.splice(0)).toEqual([
    `layout-off:${failedOwner}:error:-1`,
    `layout-on:${failedOwner}:primary:3`,
    `passive-off:${failedOwner}:error:-1`,
    `passive-on:${failedOwner}:primary:3`,
  ]);
  expect(deletions.splice(0)).toEqual([`delete:${failedOwner}:error`]);
  const recoveredIdentifier = getFiberId(getProbe(failedOwner, "primary"));
  expect([errorIdentifier, ...identifiers]).not.toContain(recoveredIdentifier);
  expect(getFiberById(errorIdentifier)).toBeNull();
  expect(getFiberById(identifiers[failedOwner])).toBeNull();
  for (const [owner, harness] of harnesses.entries()) {
    await harness.render(null);
    const value = owner === failedOwner ? 3 : 2;
    expect(effects.splice(0)).toEqual([
      `layout-off:${owner}:primary:${value}`,
      `passive-off:${owner}:primary:${value}`,
    ]);
    expect(deletions.splice(0)).toEqual([`delete:${owner}:primary`]);
  }
  for (const identifier of [...identifiers, errorIdentifier, recoveredIdentifier])
    expect(getFiberById(identifier)).toBeNull();
  expect(failures.map((error) => error === failure)).toEqual([true]);
  return transcript;
};

it.each([0, 1])(
  "replays rejection recovery without poisoning an abandoned transition in the other root, failed root %i",
  async (failedOwner) => {
    expect(await runRejectedTransition(failedOwner)).toEqual(
      await runRejectedTransition(failedOwner),
    );
  },
);
