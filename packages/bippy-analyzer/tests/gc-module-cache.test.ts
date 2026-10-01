import { expect, it } from "vite-plus/test";
import { createConcreteRuntime } from "../src/concrete/runtime.js";
import { getSymbolicEngine } from "../src/symbolic/load-engine.js";
import { getCollectedReference } from "./helpers/concrete-gc.js";
import { getNativeGcObservation } from "./helpers/native-gc.js";

interface ModuleCase {
  name: string;
  source: string;
  getTarget: string;
  rejects: boolean;
  nativeRetained?: boolean;
}

const cases: ModuleCase[] = [
  {
    name: "exported object",
    source: "export const target = {};",
    getTarget: "value.target",
    rejects: false,
  },
  {
    name: "exported symbol",
    source: "export const target = Symbol('held');",
    getTarget: "value.target",
    rejects: false,
  },
  { name: "namespace", source: "export const target = 1;", getTarget: "value", rejects: false },
  {
    name: "cached syntax error",
    source: "export const = ;",
    getTarget: "value",
    rejects: true,
    nativeRetained: false,
  },
  {
    name: "cached evaluation error",
    source: 'throw new Error("cached evaluation failure");',
    getTarget: "value",
    rejects: true,
  },
];

it("records Node's distinct syntax-error instances rather than claiming engine cache parity", () => {
  const specifier = JSON.stringify(
    `data:text/javascript,${encodeURIComponent("export const = ;")}`,
  );
  expect(
    getNativeGcObservation(
      `var first, second; await import(${specifier}).catch(error => {first = error;}); await import(${specifier}).catch(error => {second = error;});`,
      "String(first === second)",
    ),
  ).toBe("false");
});

it.each(cases.filter((entry) => entry.nativeRetained !== false))(
  "native completed module retains $name",
  ({ source, getTarget, rejects }) => {
    const specifier = `data:text/javascript,${encodeURIComponent(source)}`;
    const observe = `(value) => { reference = new WeakRef(${getTarget}); }`;
    expect(
      getNativeGcObservation(
        `var reference; await import(${JSON.stringify(specifier)}).then(${rejects ? `undefined, ${observe}` : observe});`,
        "String(reference.deref() !== undefined)",
      ),
    ).toBe("true");
  },
);

it.each(cases)(
  "retains $name in the builtin cache across fresh imports and releases a detached cache",
  async ({ source, getTarget, rejects }) => {
    const runtime = await createConcreteRuntime({
      modules: [{ specifier: "file:///cached.js", source }],
    });
    try {
      const callback = `(value) => {reference = new WeakRef(${getTarget});}`;
      runtime.evaluate(
        `var reference, same; import("file:///cached.js").then(${rejects ? `undefined, ${callback}` : callback});`,
      );
      runtime.drainJobs();
      expect(await getCollectedReference(runtime)).toBe("true");
      const compare = `(value) => {same = reference.deref() === ${getTarget};}`;
      runtime.evaluate(
        `import("file:///cached.js").then(${rejects ? `undefined, ${compare}` : compare});`,
      );
      runtime.drainJobs();
      expect(runtime.readString("String(same)")).toBe("true");
      runtime.realm.HostDefined.resolverCache = undefined;
      expect(await getCollectedReference(runtime)).toBe("false");
    } finally {
      runtime.dispose();
    }
  },
);

it.each(cases.filter((entry) => !entry.rejects))(
  "retains $name through the original importing ScriptRecord without a host cache",
  async ({ source, getTarget }) => {
    const runtime = await createConcreteRuntime();
    const { api } = await getSymbolicEngine();
    let compilations = 0;
    runtime.agent.hostDefinedOptions.hostHooks = {
      ...runtime.agent.hostDefinedOptions.hostHooks,
      HostLoadImportedModule: (referrer, request, _hostDefined, payload) => {
        const existing = referrer.LoadedModules.find(
          (entry) => entry.Specifier === request.Specifier,
        );
        if (existing) api.FinishLoadingImportedModule(referrer, request, payload, existing.Module);
        else {
          compilations++;
          api.FinishLoadingImportedModule(
            referrer,
            request,
            payload,
            api.EnsureCompletion(runtime.realm.compileModule(source)),
          );
        }
      },
    };
    try {
      runtime.evaluate(
        `var reference, same; var readAgain = () => import("file:///cached.js"); readAgain().then(value => {reference = new WeakRef(${getTarget});});`,
      );
      runtime.drainJobs();
      expect(await getCollectedReference(runtime)).toBe("true");
      runtime.evaluate(`readAgain().then(value => {same = reference.deref() === ${getTarget};});`);
      runtime.drainJobs();
      expect(runtime.readString("String(same)")).toBe("true");
      expect(compilations).toBe(1);
      runtime.evaluate("readAgain = undefined;");
      expect(await getCollectedReference(runtime)).toBe("false");
    } finally {
      runtime.dispose();
    }
  },
);
