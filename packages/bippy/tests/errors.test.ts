import { expect, it } from "vite-plus/test";
import {
  BippyError,
  BippyHookInstallationError,
  BippyHookInspectionError,
  BippyHookListenerError,
  BippyHookRenderError,
  BippyInstrumentationError,
  BippyReactBuildError,
  BippyReactDevToolsError,
  BippySourceMapError,
  BippyUnsupportedHookError,
  runWithBippyError,
} from "../src/errors.js";

it("creates stable named Bippy errors with their original cause", () => {
  const cause = new Error("original failure");
  const instrumentationError = new BippyInstrumentationError(
    "test-instrumentation",
    "onCommitFiberRoot",
    cause,
  );
  const reactDevToolsError = new BippyReactDevToolsError("onCommitFiberRoot", cause);
  const hookListenerError = new BippyHookListenerError("onRendererInject", cause);

  expect(instrumentationError).toBeInstanceOf(BippyError);
  expect(instrumentationError.name).toBe("BippyInstrumentationError");
  expect(instrumentationError.callbackName).toBe("onCommitFiberRoot");
  expect(instrumentationError.instrumentationName).toBe("test-instrumentation");
  expect(instrumentationError.cause).toBe(cause);
  expect(reactDevToolsError.name).toBe("BippyReactDevToolsError");
  expect(reactDevToolsError.cause).toBe(cause);
  expect(hookListenerError.name).toBe("BippyHookListenerError");
  expect(hookListenerError.cause).toBe(cause);
  expect(new BippyHookInstallationError(cause).name).toBe("BippyHookInstallationError");
  expect(new BippyReactBuildError("build failure").name).toBe("BippyReactBuildError");
  expect(new BippyHookInspectionError("inspection failure").name).toBe("BippyHookInspectionError");
  expect(new BippyHookRenderError("render failure").name).toBe("BippyHookRenderError");
  expect(new BippyUnsupportedHookError("unsupported hook").name).toBe("BippyUnsupportedHookError");
  expect(new BippySourceMapError("source-map failure").name).toBe("BippySourceMapError");
});

it("synchronously propagates callback failures as named Bippy errors", () => {
  const cause = new Error("listener failure");
  let propagatedError: unknown;
  try {
    runWithBippyError(
      () => {
        throw cause;
      },
      (cause) => new BippyInstrumentationError("test-instrumentation", "onActive", cause),
    );
  } catch (error) {
    propagatedError = error;
  }
  expect(propagatedError).toBeInstanceOf(BippyInstrumentationError);
  if (!(propagatedError instanceof BippyInstrumentationError)) {
    throw new Error("Expected a BippyInstrumentationError");
  }
  expect(propagatedError.cause).toBe(cause);
});

it("returns successful callback values unchanged", () => {
  expect(
    runWithBippyError(
      () => 42,
      (cause) => new BippyError("failure", cause),
    ),
  ).toBe(42);
});

it("does not obscure an existing Bippy error", () => {
  const existingError = new BippyInstrumentationError(
    "test-instrumentation",
    "onActive",
    new Error("listener failure"),
  );
  expect(() =>
    runWithBippyError(
      () => {
        throw existingError;
      },
      (cause) => new BippyHookListenerError("onActive", cause),
    ),
  ).toThrow(existingError);
});
