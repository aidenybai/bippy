import { runInNewContext } from "node:vm";
import * as concreteEngine from "@engine262/engine262";
import { expect } from "vite-plus/test";
import {
  evaluateSymbolicExpression,
  SymbolicEngineError,
  type ExpressionEvaluation,
  type Guard,
  type NormalObservation,
  type ThrowObservation,
} from "../../src/index.js";
import { evaluateGuard } from "../../src/symbolic/guards.js";

interface ConcreteResult {
  kind: "normal" | "throw";
  value?: unknown;
  name?: string;
  message?: string;
}

interface ConcreteEvaluation {
  completion: ConcreteResult;
  evaluations: ExpressionEvaluation[];
}

const getGuardValue = (guard: Guard, inputs: ReadonlyMap<string, boolean>): boolean => {
  switch (guard.kind) {
    case "constant":
      return guard.value;
    case "truthy": {
      expect(guard.variable.path).toEqual([]);
      expect(guard.variable.measure).toBe("value");
      const value = inputs.get(guard.variable.input);
      if (value === undefined) throw new SymbolicEngineError("Undeclared input in a scalar guard");
      return value;
    }
    case "not":
      return !getGuardValue(guard.operand, inputs);
    case "and":
      return guard.operands.map((operand) => getGuardValue(operand, inputs)).every(Boolean);
  }
};

const getConcreteResult = (
  source: string,
  inputs: ReadonlyMap<string, boolean>,
): ConcreteEvaluation => {
  const previousAgent = concreteEngine.surroundingAgent;
  const options: concreteEngine.AgentHostDefined = { startEventLoop: false };
  concreteEngine.setSurroundingAgent(new concreteEngine.Agent(options));
  try {
    const realm = new concreteEngine.ManagedRealm();
    const pop = realm.pushTopContext();
    try {
      for (const [input, value] of inputs) {
        const defined = concreteEngine.EnsureCompletion(
          concreteEngine.skipDebugger(
            concreteEngine.CreateDataPropertyOrThrow(
              realm.GlobalObject,
              concreteEngine.Value(input),
              concreteEngine.Value(value),
            ),
          ),
        );
        expect(defined).toBeInstanceOf(concreteEngine.NormalCompletion);
      }
      const evaluations: ExpressionEvaluation[] = [];
      options.onNodeEvaluation = (node) =>
        evaluations.push({
          nodeType: node.type,
          sourceText: node.sourceText,
          startIndex: node.location.startIndex,
          endIndex: node.location.endIndex,
        });
      const result = concreteEngine.EnsureCompletion(
        realm.evaluateScriptSkipDebugger(`(${source}\n)`, { specifier: "symbolic-expression.js" }),
      );
      options.onNodeEvaluation = undefined;
      const value = result.Value;
      if (result instanceof concreteEngine.ThrowCompletion) {
        if (!(value instanceof concreteEngine.ObjectValue))
          throw new SymbolicEngineError("Expected an engine-created scalar error");
        const name = concreteEngine.EnsureCompletion(
          concreteEngine.skipDebugger(concreteEngine.Get(value, concreteEngine.Value("name"))),
        );
        const message = concreteEngine.EnsureCompletion(
          concreteEngine.skipDebugger(concreteEngine.Get(value, concreteEngine.Value("message"))),
        );
        expect(name).toBeInstanceOf(concreteEngine.NormalCompletion);
        expect(message).toBeInstanceOf(concreteEngine.NormalCompletion);
        if (
          !(name.Value instanceof concreteEngine.JSStringValue) ||
          !(message.Value instanceof concreteEngine.JSStringValue)
        )
          throw new SymbolicEngineError("Expected scalar error name and message strings");
        return {
          evaluations,
          completion: {
            kind: "throw",
            name: name.Value.stringValue(),
            message: message.Value.stringValue(),
          },
        };
      }
      if (value instanceof concreteEngine.NumberValue)
        return { evaluations, completion: { kind: "normal", value: value.numberValue() } };
      if (value instanceof concreteEngine.BigIntValue)
        return { evaluations, completion: { kind: "normal", value: value.bigintValue() } };
      if (value instanceof concreteEngine.JSStringValue)
        return { evaluations, completion: { kind: "normal", value: value.stringValue() } };
      if (value instanceof concreteEngine.BooleanValue)
        return { evaluations, completion: { kind: "normal", value: value.value } };
      if (value instanceof concreteEngine.NullValue)
        return { evaluations, completion: { kind: "normal", value: null } };
      if (value instanceof concreteEngine.UndefinedValue)
        return { evaluations, completion: { kind: "normal", value: undefined } };
      throw new SymbolicEngineError("Unexpected concrete fixture result");
    } finally {
      pop?.();
    }
  } finally {
    concreteEngine.setSurroundingAgent(previousAgent);
  }
};

export const decodeObservation = (
  observation: NormalObservation | ThrowObservation,
): ConcreteResult => {
  if (observation.kind === "throw") return observation;
  const { value } = observation;
  switch (value.type) {
    case "Number":
      return { kind: "normal", value: Number(value.value) };
    case "BigInt":
      return { kind: "normal", value: BigInt(String(value.value)) };
    case "Undefined":
      return { kind: "normal", value: undefined };
    default:
      return { kind: "normal", value: value.value };
  }
};

export const checkScalarExpression = async (
  source: string,
  inputNames: readonly string[] = ["enabled", "other"],
): Promise<void> => {
  const result = await evaluateSymbolicExpression(source, inputNames, { captureTrace: true });
  expect(JSON.parse(JSON.stringify(result)), source).toEqual(result);
  expect(result.evaluations, source).toBeDefined();
  expect(
    result.evaluations?.map((entry) => entry.expression.sourceText),
    source,
  ).toEqual(result.visitedExpressions);
  const observed = new Set<number>();
  const observedEvaluations = new Set<number>();
  for (let mask = 0; mask < 2 ** inputNames.length; mask++) {
    const inputs = new Map(inputNames.map((input, index) => [input, Boolean(mask & (1 << index))]));
    const witness = `${source}\n${JSON.stringify(Object.fromEntries(inputs))}`;
    const matching = result.outcomes.filter((outcome, index) => {
      const resolved = getGuardValue(outcome.guard, inputs);
      expect(evaluateGuard(outcome.guard, inputs), witness).toBe(resolved);
      if (resolved) observed.add(index);
      return resolved;
    });
    expect(matching, witness).toHaveLength(1);
    const observation = decodeObservation(matching[0].completion);
    const concrete = getConcreteResult(source, inputs);
    expect(observation, witness).toEqual(concrete.completion);
    const evaluations = result.evaluations
      ?.filter((entry, index) => {
        const resolved = getGuardValue(entry.guard, inputs);
        expect(evaluateGuard(entry.guard, inputs), witness).toBe(resolved);
        if (resolved) observedEvaluations.add(index);
        return resolved;
      })
      .map((entry) => entry.expression);
    expect(evaluations, witness).toEqual(concrete.evaluations);
    let native: ConcreteResult;
    try {
      native = {
        kind: "normal",
        value: runInNewContext(`(${source}\n)`, Object.fromEntries(inputs)),
      };
    } catch (error) {
      if (
        typeof error !== "object" ||
        error === null ||
        !("name" in error) ||
        typeof error.name !== "string"
      )
        throw error;
      native = { kind: "throw", name: error.name };
    }
    expect(observation.kind, witness).toBe(native.kind);
    if (observation.kind === "throw") expect(observation.name, witness).toBe(native.name);
    else expect(observation, witness).toEqual(native);
  }
  expect(observed.size, source).toBe(result.outcomes.length);
  expect(observedEvaluations.size, source).toBe(result.evaluations?.length);
};
