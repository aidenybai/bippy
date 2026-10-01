import { expect, it, vi } from "vite-plus/test";
import { Interpreter } from "../src/evaluate/interpreter.js";
import { TimerQueue } from "../src/evaluate/timers.js";
import { primitiveValue, unknownValue } from "../src/evaluate/values.js";
import {
  checkDifferentialCases,
  checkKnownDifferentialCases,
  checkKnownDifferentialWitnesses,
} from "./helpers/differential-evaluator.js";

const knownWitness = { name: "exact witness", body: "return 7;", expected: 7, actual: "0" };

it("accepts only the recorded native and analyzer witness", async () => {
  using corrupted = vi.spyOn(Interpreter.prototype, "callValue").mockReturnValue(primitiveValue(0));
  await checkKnownDifferentialWitnesses([knownWitness]);
  expect(corrupted).toHaveBeenCalled();
});

it.each([
  { name: "a different wrong result", value: primitiveValue(2) },
  { name: "a precision regression", value: unknownValue("injected uncertainty") },
  { name: "a corrected result", value: primitiveValue(7) },
])("rejects $name in a recorded witness", async ({ value }) => {
  using corrupted = vi.spyOn(Interpreter.prototype, "callValue").mockReturnValue(value);
  await expect(checkKnownDifferentialWitnesses([knownWitness])).rejects.toThrow();
  expect(corrupted).toHaveBeenCalled();
});

it("does not let one remaining mismatch hide a corrected witness in a batch", async () => {
  using corrupted = vi
    .spyOn(Interpreter.prototype, "callValue")
    .mockReturnValueOnce(primitiveValue(0))
    .mockReturnValue(primitiveValue(7));
  await expect(
    checkKnownDifferentialWitnesses([knownWitness, { ...knownWitness, name: "second witness" }]),
  ).rejects.toThrow();
  expect(corrupted).toHaveBeenCalled();
});

it("rejects a changed native reference even when the wrong analyzer output is unchanged", async () => {
  using corrupted = vi.spyOn(Interpreter.prototype, "callValue").mockReturnValue(primitiveValue(0));
  await expect(
    checkKnownDifferentialWitnesses([{ ...knownWitness, body: "return 8;" }]),
  ).rejects.toThrow();
  expect(corrupted).toHaveBeenCalled();
});

it("compares primitive edge values without JSON normalization", async () => {
  await checkDifferentialCases(
    ["NaN", "-0", "0", "Infinity", "-Infinity", "undefined", "null", "false", "''"].map(
      (value) => ({
        name: value,
        body: `return ${value};`,
      }),
    ),
  );
});

it("detects a deliberately corrupted signed-zero result", async () => {
  using corrupted = vi.spyOn(Interpreter.prototype, "callValue").mockReturnValue(primitiveValue(0));
  await expect(
    checkDifferentialCases([{ name: "signed zero", body: "return -0;" }]),
  ).rejects.toMatchObject({
    actual: [{ name: "signed zero", expected: -0, actual: "0" }],
  });
  expect(corrupted).toHaveBeenCalled();
});

it("rejects an empty fuzz campaign instead of passing vacuously", async () => {
  await expect(checkDifferentialCases([])).rejects.toThrow("must not be empty");
});

it("does not let a reference syntax error satisfy a known-divergence guard", async () => {
  await expect(
    checkKnownDifferentialCases([{ name: "invalid reference", body: "return (" }]),
  ).rejects.toThrow("DifferentialMismatch");
});

it("does not let an unexpected evaluator crash satisfy a known-divergence guard", async () => {
  using corrupted = vi.spyOn(Interpreter.prototype, "callValue").mockImplementation(() => {
    throw new Error("unexpected evaluator failure");
  });
  await expect(checkKnownDifferentialCases([{ name: "crash", body: "return 7;" }])).rejects.toThrow(
    "DifferentialMismatch",
  );
  expect(corrupted).toHaveBeenCalled();
});

it("requires removing a known-divergence guard when native behavior is satisfied", async () => {
  await expect(
    checkKnownDifferentialCases([{ name: "correct", body: "return 7;" }]),
  ).rejects.toThrow("resolved");
});

it("detects a missing microtask checkpoint against a fully drained native VM", async () => {
  using corrupted = vi
    .spyOn(TimerQueue.prototype, "drainMicrotasks")
    .mockImplementationOnce(() => {});
  await expect(
    checkDifferentialCases(
      [
        {
          name: "microtask checkpoint",
          body: `const trace = []; Promise.resolve().then(() => { trace.push('P'); queueMicrotask(() => trace.push('nested')); }); queueMicrotask(() => trace.push('Q')); trace.push('sync'); return () => trace.join('|');`,
        },
      ],
      true,
    ),
  ).rejects.toMatchObject({
    actual: [{ name: "microtask checkpoint", expected: "sync|P|Q|nested", actual: '"sync"' }],
  });
  expect(corrupted).toHaveBeenCalled();
});

it("does not treat an invalid microtask reference as a known divergence", async () => {
  await expect(
    checkKnownDifferentialCases([{ name: "missing snapshot", body: "return 7;" }], true),
  ).rejects.toThrow("DifferentialMismatch");
});

it("does not accept an unknown result as matching a concrete native result", async () => {
  using corrupted = vi
    .spyOn(Interpreter.prototype, "callValue")
    .mockReturnValue(unknownValue("injected uncertainty"));
  await expect(
    checkDifferentialCases([{ name: "concrete answer", body: "return 7;" }]),
  ).rejects.toMatchObject({
    actual: [{ name: "concrete answer", expected: 7, actual: "unknown(injected uncertainty)" }],
  });
  expect(corrupted).toHaveBeenCalled();
});
