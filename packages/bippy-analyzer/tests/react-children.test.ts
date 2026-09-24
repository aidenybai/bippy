import { describe, expect, it, vi } from "vite-plus/test";
import type { CallbackEvaluator } from "../src/evaluate/callbacks.js";
import type { ValueCaller } from "../src/evaluate/context.js";
import {
  childrenToArray,
  countChildrenExactly,
  mapChildren,
  mapChildrenExactly,
} from "../src/evaluate/react-children.js";
import { createStaticElement } from "../src/evaluate/react-elements.js";
import { createScope } from "../src/evaluate/scope.js";
import {
  listValue,
  objectFromRecord,
  objectValue,
  primitiveValue,
} from "../src/evaluate/values.js";
import type { StaticRepeatValue } from "../src/types.js";
import { createCallbackValue, createEvaluationContext } from "./helpers/evaluation-context.js";

describe("React children without an interpreter", () => {
  it("flattens exact children and passes normalized children, indices, and thisArg to the caller", () => {
    const context = createEvaluationContext();
    const callback = createCallbackValue(context);
    const thisArg = objectFromRecord({ name: primitiveValue("receiver") });
    const callValue = vi.fn<ValueCaller["callValue"]>(
      (_callback, argumentsList) => argumentsList[0],
    );
    const children = listValue([
      primitiveValue("first"),
      listValue([primitiveValue(false), primitiveValue("second")]),
    ]);
    const result = mapChildrenExactly({ callValue }, children, callback, thisArg, context, null);
    expect(result).toMatchObject({
      kind: "list",
      items: [primitiveValue("first"), primitiveValue("second")],
    });
    expect(callValue).toHaveBeenCalledTimes(3);
    expect(callValue).toHaveBeenNthCalledWith(
      1,
      callback,
      [primitiveValue("first"), primitiveValue(0)],
      context,
      null,
      { thisValue: thisArg },
    );
    expect(callValue).toHaveBeenNthCalledWith(
      2,
      callback,
      [primitiveValue(null), primitiveValue(1)],
      context,
      null,
      { thisValue: thisArg },
    );
    expect(callValue).toHaveBeenNthCalledWith(
      3,
      callback,
      [primitiveValue("second"), primitiveValue(2)],
      context,
      null,
      { thisValue: thisArg },
    );
    expect(countChildrenExactly(children)).toBe(3);
  });

  it("escapes explicit keys and assigns traversal keys without mutating the original element", () => {
    const context = createEvaluationContext();
    const explicit = createStaticElement(
      primitiveValue("div"),
      objectValue(),
      primitiveValue("a:b=c"),
      [],
      null,
      null,
      context,
    );
    const implicit = createStaticElement(
      primitiveValue("span"),
      objectValue(),
      null,
      [],
      null,
      null,
      context,
    );
    const callValue = vi.fn<ValueCaller["callValue"]>(
      (_callback, argumentsList) => argumentsList[0],
    );
    const result = childrenToArray(
      { callValue },
      listValue([explicit, listValue([implicit])]),
      context,
      null,
    );
    expect(result).toMatchObject({
      kind: "list",
      items: [
        { kind: "element", key: primitiveValue(".$a=2b=0c") },
        { kind: "element", key: primitiveValue(".1:0") },
      ],
    });
    expect(explicit).toMatchObject({ key: primitiveValue("a:b=c") });
    expect(implicit).toMatchObject({ key: null });
  });

  it("models Flight deferral alternatives without calling the mapper again", () => {
    const context = createEvaluationContext();
    context.environment = "client";
    const children = listValue(
      ["first", "second"].map((key) =>
        createStaticElement(
          primitiveValue("div"),
          objectValue(),
          primitiveValue(key),
          [],
          null,
          null,
          { environment: "server", owner: null },
        ),
      ),
    );
    const callValue = vi.fn<ValueCaller["callValue"]>(
      (_callback, argumentsList) => argumentsList[0],
    );
    const result = mapChildrenExactly(
      { callValue },
      children,
      createCallbackValue(context),
      undefined,
      context,
      null,
    );
    expect(callValue).toHaveBeenCalledTimes(2);
    if (result?.kind !== "branch") throw new Error("Expected Flight key alternatives");
    expect(result.alternatives).toHaveLength(3);
    expect(result.alternatives).toMatchObject([
      {
        kind: "list",
        items: [{ key: primitiveValue(".$first") }, { key: primitiveValue(".$second") }],
      },
      { kind: "list", items: [{ key: primitiveValue(".0") }, { key: primitiveValue(".1") }] },
      { kind: "list", items: [{ key: primitiveValue(".$first") }, { key: primitiveValue(".1") }] },
    ]);
  });

  it("runs a repeated child mapper conditionally in its closure scope", () => {
    const context = createEvaluationContext();
    const callback = createCallbackValue(context);
    callback.scope = createScope(null);
    const repeat: StaticRepeatValue = {
      kind: "repeat",
      item: primitiveValue("child"),
      location: null,
    };
    const callValue = vi.fn<ValueCaller["callValue"]>(
      (_callback, argumentsList) => argumentsList[0],
    );
    const conditionalCall = vi.fn();
    const evaluator: CallbackEvaluator = {
      callValue,
      runMaybe: (scope, run, reason, location, isLikelyRun, isRepeated, options) => {
        conditionalCall(scope, reason, location, isLikelyRun, isRepeated, options);
        return run();
      },
    };
    expect(mapChildren(evaluator, repeat, callback, undefined, context, null)).toMatchObject({
      kind: "repeat",
      item: primitiveValue("child"),
    });
    expect(conditionalCall).toHaveBeenCalledWith(
      callback.scope,
      "callback for an item that may not occur",
      null,
      true,
      true,
      { predicate: undefined },
    );
    expect(callValue).toHaveBeenCalledWith(
      callback,
      [repeat.item, { kind: "unknown-primitive", primitiveType: "number", reason: "index" }],
      context,
      null,
    );
  });
});
