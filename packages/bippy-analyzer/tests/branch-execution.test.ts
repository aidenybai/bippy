import { expect, it } from "vite-plus/test";
import type { EvaluationContext } from "../src/evaluate/context.js";
import { Interpreter } from "../src/evaluate/interpreter.js";
import { getAlternativeGuards, getTruthinessPredicate } from "../src/evaluate/predicates.js";
import { createScope } from "../src/evaluate/scope.js";
import {
  branchValue,
  getObjectProperty,
  objectFromRecord,
  primitiveValue,
  UNDEFINED_VALUE,
  unknownPrimitiveValue,
} from "../src/evaluate/values.js";
import { ModuleGraph } from "../src/graph/module-graph.js";
import { createModuleRecord } from "../src/graph/module-record.js";
import { ModuleResolver } from "../src/graph/module-resolver.js";
import { parseSourceText } from "../src/parse/parse-source-file.js";
import { createEvaluationContext } from "./helpers/evaluation-context.js";

interface ForkRunner {
  name: string;
  run: (interpreter: Interpreter, context: EvaluationContext, mutate: () => never) => void;
}

const createInterpreter = () =>
  new Interpreter(
    new ModuleGraph({ resolver: new ModuleResolver({ rootDirectory: import.meta.dirname }) }),
  );

const createChoice = () => {
  const condition = unknownPrimitiveValue("boolean", "condition");
  const choice = branchValue(
    [primitiveValue(1), primitiveValue(2)],
    "condition",
    null,
    0,
    getTruthinessPredicate(condition),
  );
  if (choice.kind !== "branch") throw new Error("Expected branch");
  return choice;
};

const runners: ForkRunner[] = [
  {
    name: "optional execution",
    run: (interpreter, context, mutate) => {
      interpreter.runMaybe(context.scope, mutate, "optional", null);
    },
  },
  {
    name: "value alternatives",
    run: (interpreter, context, mutate) => {
      interpreter.callAlternatives(createChoice(), context, mutate);
    },
  },
  {
    name: "task alternatives",
    run: (interpreter, context, mutate) => {
      const resolved = getAlternativeGuards(createChoice());
      if (!resolved) throw new Error("Expected guards");
      interpreter.runTaskAlternatives(
        resolved.guards.map((guard) => ({ guard, inputs: [...resolved.inputs] })),
        mutate,
        "tasks",
        context,
      );
    },
  },
  {
    name: "statement paths",
    run: (interpreter, context, mutate) => {
      const module = createModuleRecord(
        parseSourceText("/failure.ts", "if (condition) crash(); else count = 2;", "ts"),
      );
      context.scope.bindings.set("condition", unknownPrimitiveValue("boolean", "condition"));
      context.scope.bindings.set("crash", { kind: "native-function", name: "crash", call: mutate });
      interpreter.evaluateBlock(module.file.program.body, { ...context, module }, false);
    },
  },
];

it.each(runners)("rolls back $name after an internal failure", ({ run }) => {
  const interpreter = createInterpreter();
  const context = createEvaluationContext();
  context.scope = createScope(context.scope);
  context.scope.bindings.set("count", primitiveValue(0));
  const object = objectFromRecord({ count: primitiveValue(0) });
  const failure = new Error("internal failure");
  const mutate = (): never => {
    context.scope.bindings.set("count", primitiveValue(1));
    interpreter.recordHeapMutation(object);
    object.integrity = primitiveValue("frozen");
    object.entries.push({ kind: "property", key: "count", value: primitiveValue(1) });
    interpreter.timers.enqueue(() => {
      throw new Error("Discarded task executed");
    });
    throw failure;
  };
  expect(() => run(interpreter, context, mutate)).toThrow(failure);
  expect(context.scope.bindings.get("count")).toEqual(primitiveValue(0));
  expect(getObjectProperty(object, "count")).toEqual(primitiveValue(0));
  expect(object.integrity).toBeUndefined();
  expect(interpreter.timers.hasTasks()).toBe(false);
  interpreter.timers.runNextTask();
  const values: number[] = [];
  interpreter.callAlternatives(createChoice(), context, (value) => {
    if (value.kind === "primitive" && typeof value.value === "number") values.push(value.value);
    return UNDEFINED_VALUE;
  });
  expect(values).toEqual([1, 2]);
});

it("keeps unresolved binding identity within its module, environment, and run", () => {
  const interpreter = createInterpreter();
  const context = createEvaluationContext();
  const input = interpreter.lookupIdentifier("first", context);
  expect(interpreter.lookupIdentifier("first", context)).toBe(input);
  expect(interpreter.lookupIdentifier("second", context)).not.toBe(input);
  expect(interpreter.lookupIdentifier("first", createEvaluationContext())).not.toBe(input);
  expect(interpreter.lookupIdentifier("first", { ...context, environment: "server" })).not.toBe(
    input,
  );
  expect(createInterpreter().lookupIdentifier("first", context)).not.toBe(input);
  context.scope.bindings.set("first", primitiveValue(false));
  expect(interpreter.lookupIdentifier("first", context)).toEqual(primitiveValue(false));
});

it("retains inherited input declarations when a task adds no new inputs", () => {
  const interpreter = createInterpreter();
  const context = createEvaluationContext();
  const module = createModuleRecord(parseSourceText("/task.ts", "count += 1;", "ts"));
  context.scope.bindings.set("count", primitiveValue(0));
  const selecting = getAlternativeGuards(createChoice());
  if (!selecting) throw new Error("Expected selecting guards");
  interpreter.runWithGuard(
    selecting.guards[0],
    () =>
      interpreter.runTaskWithCause(
        { guard: { kind: "constant", value: true }, inputs: [] },
        () => interpreter.evaluateBlock(module.file.program.body, { ...context, module }, false),
        context,
      ),
    selecting.inputs,
  );
  const count = context.scope.bindings.get("count");
  if (count?.kind !== "branch") throw new Error("Expected guarded count");
  expect(getAlternativeGuards(count)?.inputs).toEqual(selecting.inputs);
  expect(count.alternatives).toEqual([primitiveValue(1), primitiveValue(0)]);
});
