import * as React from "react";
import { createPortal } from "react-dom";
import { getFiber, getFiberById, getFiberId, getLatestFiber, instrument, type Fiber } from "bippy";
import { expect, it, vi } from "vite-plus/test";
import { getFiberPreorder } from "./fiber-fixture.js";
import { createRenderHarness } from "./render-harness.js";

interface FaultProbeProps {
  name: string;
}

interface FaultBoundaryProps {
  children: React.ReactNode;
}

interface FaultBoundaryState {
  didFail: boolean;
}

interface FaultGateProps extends FaultBoundaryProps {
  isHidden: boolean;
}

interface FaultIdentity {
  identifier: number;
  hostIdentifier: number;
  fiber: Fiber;
  host: HTMLElement;
}

const runRefFailure = async (mode: string): Promise<string[]> => {
  const transcript: string[] = [];
  const trace: string[] = [];
  const record = (entry: string): void => {
    trace.push(entry);
    transcript.push(entry);
  };
  const refFailure = new Error("ref cleanup failed");
  const instrumentationFailure = new Error("unmount observer failed");
  const caught: unknown[] = [];
  const harness = createRenderHarness({
    onCaughtError: (error) => {
      caught.push(error);
      record(`caught:${error === refFailure}`);
    },
  });
  const control = createRenderHarness();
  const portal = document.createElement("aside");
  const pending = new Promise<void>(() => {});
  const records = new Map<string, FaultIdentity>();
  let shouldThrow = true;
  const Probe = ({ name }: FaultProbeProps) => {
    const ref = React.useCallback(
      (host: HTMLSpanElement | null) => {
        if (!host) {
          record(`unexpected-null:${name}`);
          return;
        }
        const fiber = getFiber(host);
        if (!fiber) throw new Error(`Missing host fiber: ${name}`);
        const identifier = getFiberId(getLatestFiber(fiber));
        record(`ref-on:${name}`);
        return () => {
          record(`ref-off:${name}:${getFiberById(identifier) === null}`);
          if (name === "primary" && shouldThrow) {
            shouldThrow = false;
            throw refFailure;
          }
        };
      },
      [name],
    );
    React.useLayoutEffect(() => {
      record(`layout-on:${name}`);
      return () => {
        record(`layout-off:${name}`);
      };
    }, [name]);
    React.useEffect(() => {
      record(`passive-on:${name}`);
      return () => {
        record(`passive-off:${name}`);
      };
    }, [name]);
    return createPortal(
      <span ref={ref} data-probe={name}>
        {name}
      </span>,
      portal,
      "shared",
    );
  };
  class Boundary extends React.Component<FaultBoundaryProps, FaultBoundaryState> {
    state = { didFail: false };
    static getDerivedStateFromError = (): FaultBoundaryState => ({ didFail: true });
    render = () => (this.state.didFail ? <Probe name="error" /> : this.props.children);
  }
  const Gate = ({ isHidden, children }: FaultGateProps) => {
    if (isHidden) throw pending;
    return children;
  };
  using _reporter = vi
    .spyOn(console, "error")
    .mockImplementation((message: unknown, error: unknown) => {
      record(`report:${message}:${error === instrumentationFailure}`);
      throw new Error("reporter failed");
    });
  using _observer = instrument({
    onCommitFiberRoot: (_rendererId, root) => {
      if (!("containerInfo" in root) || root.containerInfo !== harness.container) return;
      const fibers = getFiberPreorder(root.current).filter((fiber) => fiber.type === Probe);
      record(`commit:${fibers.map((fiber) => fiber.memoizedProps.name).join(",")}`);
      for (const fiber of fibers) {
        const name = String(fiber.memoizedProps.name);
        const hostFiber = getFiberPreorder(fiber).find((candidate) => candidate.type === "span");
        if (!hostFiber || !(hostFiber.stateNode instanceof HTMLElement))
          throw new Error(`Missing committed host: ${name}`);
        records.set(name, {
          identifier: getFiberId(fiber),
          hostIdentifier: getFiberId(hostFiber),
          fiber,
          host: hostFiber.stateNode,
        });
      }
    },
    onCommitFiberUnmount: (_rendererId, fiber) => {
      if (fiber.type !== Probe) return;
      record(`delete:${fiber.memoizedProps.name}`);
      throw instrumentationFailure;
    },
  });
  const render = (epoch: number, isHidden: boolean, isPresent: boolean) =>
    harness.render(
      <Boundary key={epoch}>
        {isPresent ? (
          <React.Suspense fallback={<Probe name="loading" />}>
            <Gate isHidden={isHidden}>
              <Probe name="primary" />
            </Gate>
          </React.Suspense>
        ) : null}
      </Boundary>,
    );
  await render(0, false, true);
  expect(trace.splice(0)).toEqual([
    "ref-on:primary",
    "layout-on:primary",
    "commit:primary",
    "passive-on:primary",
  ]);
  const primary = records.get("primary");
  if (!primary) throw new Error("Primary was not committed");
  await control.render(<Probe name="control" />);
  expect(trace.splice(0)).toEqual(["ref-on:control", "layout-on:control", "passive-on:control"]);
  const controlFiber = getFiberPreorder(control.getRoot().current).find(
    (fiber) => fiber.type === Probe,
  );
  if (!controlFiber) throw new Error("Missing control fiber");
  const controlIdentifier = getFiberId(controlFiber);
  const controlHostFiber = getFiberPreorder(controlFiber).find((fiber) => fiber.type === "span");
  if (!controlHostFiber) throw new Error("Missing control host fiber");
  const controlHostIdentifier = getFiberId(controlHostFiber);
  await render(0, mode === "hide", mode === "hide");
  expect(shouldThrow).toBe(false);
  expect(trace.splice(0)).toEqual(
    mode === "hide"
      ? [
          "layout-off:primary",
          "ref-off:primary:false",
          "ref-on:loading",
          "layout-on:loading",
          "commit:primary,loading",
          "passive-on:loading",
          "delete:primary",
          "report:Bippy instrumentation encountered an error::true",
          "delete:loading",
          "report:Bippy instrumentation encountered an error::true",
          "layout-off:loading",
          "ref-off:loading:true",
          "ref-on:error",
          "layout-on:error",
          "caught:true",
          "commit:error",
          "passive-off:primary",
          "passive-off:loading",
          "passive-on:error",
        ]
      : [
          "delete:primary",
          "report:Bippy instrumentation encountered an error::true",
          "layout-off:primary",
          "ref-off:primary:true",
          "commit:",
          "passive-off:primary",
          "ref-on:error",
          "layout-on:error",
          "caught:true",
          "commit:error",
          "passive-on:error",
        ],
  );
  expect(caught.map((error) => error === refFailure)).toEqual([true]);
  expect(getFiberById(primary.identifier)).toBeNull();
  expect(getFiberById(primary.hostIdentifier)).toBeNull();
  expect(primary.host.parentNode).toBeNull();
  if (mode === "hide") {
    const loading = records.get("loading");
    if (!loading) throw new Error("Suspense fallback never committed before error recovery");
    expect(getFiberById(loading.identifier)).toBeNull();
    expect(getFiberById(loading.hostIdentifier)).toBeNull();
  }
  expect(getFiberById(controlIdentifier) === controlFiber).toBe(true);
  expect(getFiberById(controlHostIdentifier) === controlHostFiber).toBe(true);
  expect(portal.firstElementChild === controlHostFiber.stateNode).toBe(true);
  expect([...portal.children].map((host) => host.textContent)).toEqual(["control", "error"]);
  const error = records.get("error");
  if (!error) throw new Error("Error fallback never committed");
  expect(getFiberById(error.identifier) === error.fiber).toBe(true);
  await render(1, false, true);
  expect(trace.splice(0)).toEqual([
    "delete:error",
    "report:Bippy instrumentation encountered an error::true",
    "layout-off:error",
    "ref-off:error:true",
    "ref-on:primary",
    "layout-on:primary",
    "commit:primary",
    "passive-off:error",
    "passive-on:primary",
  ]);
  const recovered = records.get("primary");
  if (!recovered) throw new Error("Recovery did not mount a primary");
  expect(getFiberById(recovered.identifier) === recovered.fiber).toBe(true);
  expect(recovered.identifier).not.toBe(primary.identifier);
  expect(recovered.hostIdentifier).not.toBe(primary.hostIdentifier);
  expect(getFiberById(error.identifier)).toBeNull();
  expect(getFiberById(error.hostIdentifier)).toBeNull();
  for (const { name, root } of [
    { name: "primary", root: harness },
    { name: "control", root: control },
  ]) {
    await root.render(null);
    expect(trace.splice(0)).toEqual([
      `delete:${name}`,
      "report:Bippy instrumentation encountered an error::true",
      `layout-off:${name}`,
      `ref-off:${name}:true`,
      ...(name === "primary" ? ["commit:"] : []),
      `passive-off:${name}`,
    ]);
  }
  for (const identity of records.values()) {
    expect(getFiberById(identity.identifier)).toBeNull();
    expect(getFiberById(identity.hostIdentifier)).toBeNull();
  }
  expect(getFiberById(controlIdentifier)).toBeNull();
  expect(getFiberById(controlHostIdentifier)).toBeNull();
  expect(caught).toHaveLength(1);
  expect(portal.childElementCount).toBe(0);
  return transcript;
};

it.each(["hide", "delete"])(
  "replays ref-cleanup failure during %s without losing cleanup or the other root",
  async (mode) => {
    expect(await runRefFailure(mode)).toEqual(await runRefFailure(mode));
  },
);
