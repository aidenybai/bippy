import { describe, expect, it } from "vite-plus/test";
import { getNamedContextKeys } from "../conformance/verifier/wrappers.js";

describe("getNamedContextKeys", () => {
  const contextKeys = ["/app/ui-appState.ts#UIAppStateContext", "/app/App.tsx#AppContext"];

  it("finds the context named after a hook that came up empty", () => {
    expect(
      getNamedContextKeys(
        "Cannot destructure property 'theme' of 'useUIAppState(...)' as it is null.",
        contextKeys,
      ),
    ).toEqual(["/app/ui-appState.ts#UIAppStateContext"]);
  });

  it("matches the whole name, not a suffix", () => {
    expect(
      getNamedContextKeys("Cannot destructure property 'fonts' of 'useApp(...)' as it is null.", [
        ...contextKeys,
        "/app/WebApp.tsx#WebAppContext",
      ]),
    ).toEqual(["/app/App.tsx#AppContext"]);
  });

  it("doesn't repeat the suffix of a hook named after its context", () => {
    expect(
      getNamedContextKeys(
        "Cannot destructure property 'chips' of 'useChipsContext(...)' as it is undefined.",
        ["/app/chips.tsx#ChipsContext"],
      ),
    ).toEqual(["/app/chips.tsx#ChipsContext"]);
  });

  it("finds nothing for an error that names no hook", () => {
    expect(
      getNamedContextKeys("Cannot read properties of null (reading 'scene')", contextKeys),
    ).toEqual([]);
  });
});
