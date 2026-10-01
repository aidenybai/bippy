import { describe, expect, it, vi } from "vite-plus/test";
import { evaluateReactApiCall, type ReactApiEvaluator } from "../src/evaluate/react-calls.js";
import { objectFromRecord, primitiveValue, unknownValue } from "../src/evaluate/values.js";
import type { ReactApi } from "../src/types.js";
import { createCallbackValue, createEvaluationContext } from "./helpers/evaluation-context.js";

const unexpectedCall = (): never => {
  throw new Error("Unexpected evaluator operation");
};

const createEvaluator = (): ReactApiEvaluator => ({
  assumeOuterProviders: false,
  timers: { drainMicrotasks: vi.fn(unexpectedCall) },
  callFunction: vi.fn(unexpectedCall),
  callValue: vi.fn(unexpectedCall),
  callAlternatives: vi.fn(unexpectedCall),
  report: vi.fn(unexpectedCall),
  runMaybe: unexpectedCall,
  createElement: vi.fn(unexpectedCall),
  evaluateModuleExport: vi.fn(unexpectedCall),
  recordRootRender: vi.fn(),
});

describe("React API dispatch without an interpreter", () => {
  it.each<ReactApi>(["createElement", "jsx", "jsxs", "jsxDEV"])(
    "preserves the element factory override for %s",
    (api) => {
      const evaluator = createEvaluator();
      const context = createEvaluationContext();
      const type = primitiveValue("div");
      const key = primitiveValue("config");
      const extra = primitiveValue("third argument");
      const config = objectFromRecord({ key, title: primitiveValue("title") });
      const customResult = unknownValue("custom element factory");
      vi.mocked(evaluator.createElement).mockReturnValue(customResult);
      expect(
        evaluateReactApiCall(evaluator, api, [type, config, extra], context, null, "Element"),
      ).toBe(customResult);
      expect(evaluator.createElement).toHaveBeenCalledExactlyOnceWith(
        type,
        expect.objectContaining({
          kind: "object",
          entries: [{ kind: "property", key: "title", value: primitiveValue("title") }],
        }),
        key,
        api === "createElement" ? [extra] : [],
        null,
        "Element",
        context,
      );
    },
  );

  it("awaits lazy loaders and resolves namespace defaults through module operations", () => {
    const evaluator = createEvaluator();
    const context = createEvaluationContext();
    const loader = createCallbackValue(context);
    vi.mocked(evaluator.callFunction).mockReturnValue({
      kind: "namespace",
      module: context.module,
    });
    vi.mocked(evaluator.evaluateModuleExport).mockReturnValue(primitiveValue("section"));
    expect(evaluateReactApiCall(evaluator, "lazy", [loader], context, null, null)).toMatchObject({
      kind: "component-reference",
      type: { kind: "lazy", inner: { kind: "host", tagName: "section" } },
    });
    expect(evaluator.callFunction).toHaveBeenCalledExactlyOnceWith(loader, [], context, {
      awaited: true,
    });
    expect(evaluator.evaluateModuleExport).toHaveBeenCalledExactlyOnceWith(
      context.module,
      "default",
    );
  });

  it("delegates hooks without invoking unrelated evaluator operations", () => {
    const evaluator = createEvaluator();
    const value = primitiveValue("initial");
    expect(
      evaluateReactApiCall(evaluator, "useRef", [value], createEvaluationContext(), null, null),
    ).toMatchObject({ kind: "object", entries: [{ kind: "property", key: "current", value }] });
    expect(evaluator.createElement).not.toHaveBeenCalled();
    expect(evaluator.recordRootRender).not.toHaveBeenCalled();
  });

  it("records the hydrated element rather than the container", () => {
    const evaluator = createEvaluator();
    const element = primitiveValue("element");
    expect(
      evaluateReactApiCall(
        evaluator,
        "hydrateRoot",
        [primitiveValue("container"), element],
        createEvaluationContext(),
        null,
        null,
      ),
    ).toMatchObject({ kind: "object" });
    expect(evaluator.recordRootRender).toHaveBeenCalledExactlyOnceWith(element);
  });
});
