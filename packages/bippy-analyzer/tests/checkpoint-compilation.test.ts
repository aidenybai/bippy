import { expect, it } from "vite-plus/test";
import type { EvaluationCheckpoint } from "../engine/dist/declaration/index.mjs";
import { withAbstractFixture, type AbstractFixture } from "./helpers/abstract-fixture.js";

interface CompilationFixture extends AbstractFixture {
  checkpoint: EvaluationCheckpoint;
  resume: () => unknown;
  release: () => void;
}

const boundary = "Host effects are unsupported during evaluation checkpoints";

const getFailure = (run: () => unknown): unknown => {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("Expected failure");
};

const getCounter = (realm: AbstractFixture["realm"]) => {
  const value = realm.GlobalObject.properties.get("counter")?.Value;
  if (!value) throw new Error("Expected counter");
  return value;
};

const withCheckpoint = async (
  effect: string,
  run: (fixture: CompilationFixture) => void,
  setup = "",
) => {
  await withAbstractFixture((fixture) => {
    const { agent, compile, createBoolean, evaluate } = fixture;
    if (setup) evaluate(setup);
    createBoolean("enabled");
    agent.evaluate(
      compile(`
      var caught=false, completed=false, counter=0;
      var borrowedEval=eval, borrowedFunction=Function;
      if(enabled){ try { ${effect}; } catch(error){ caught=true; } completed=true; }
    `),
      () => {},
      false,
    );
    const pause = agent.resumeEvaluate({ pauseOnAbstractBoolean: true, noBreakpoint: true });
    if (pause.done || !pause.value) throw new Error("Expected pause");
    const decision = pause.value;
    const checkpoint = agent.captureEvaluation({ capture: () => ({ restore: () => {} }) });
    let isReleased = false;
    const release = () => {
      if (!isReleased) {
        checkpoint.release();
        isReleased = true;
      }
    };
    try {
      run({
        ...fixture,
        checkpoint,
        release,
        resume: () =>
          agent.resumeEvaluate({
            abstractBooleanDecision: { resume: "abstract-boolean", decision, value: true },
            noBreakpoint: true,
          }),
      });
    } finally {
      release();
    }
  });
};

it.each(
  [
    "eval('counter++')",
    "eval('')",
    "eval('{')",
    "(0,eval)('counter++')",
    "borrowedEval('counter++')",
    "Function('return 7')()",
    "new Function('return 7')",
    "borrowedFunction.call(null,'return 7')",
    "(function*(){}).constructor('return 7')",
    "(async function(){}).constructor('return 7')",
    "(async function*(){}).constructor('return 7')",
    "Function('/*','*/return 7')",
    "JSON.parse('7')",
    `JSON.parse('{"value":7}',()=>{counter++;return 7})`,
    "JSON.rawJSON('7')",
  ].flatMap((effect) => [false, true].map((warm) => ({ effect, warm }))),
)(
  "rejects $effect before compile hooks or source registry changes, warm=$warm",
  async ({ effect, warm }) => {
    await withCheckpoint(
      effect,
      ({ api, agent, realm, resume, checkpoint }) => {
        let compilations = 0,
          registrations = 0;
        agent.hostDefinedOptions.hostHooks = {
          HostEnsureCanCompileStrings: () => {
            compilations++;
            return api.NormalCompletion(undefined);
          },
        };
        agent.hostDefinedOptions.onScriptParsed = () => {
          registrations++;
        };
        const sources = [...agent.parsedSources];
        const failure = getFailure(resume);
        expect(failure).toBeInstanceOf(TypeError);
        expect(failure).toHaveProperty("message", boundary);
        for (const retry of [resume, checkpoint.restore]) expect(getFailure(retry)).toBe(failure);
        expect(compilations).toBe(0);
        expect(registrations).toBe(0);
        expect(
          [...agent.parsedSources].map(
            ([key, value], index) => key === sources[index]?.[0] && value === sources[index]?.[1],
          ),
        ).toEqual(sources.map(() => true));
        expect(realm.GlobalObject.properties.get("caught")?.Value).toBe(api.Value.false);
        expect(realm.GlobalObject.properties.get("completed")?.Value).toBe(api.Value.false);
      },
      warm ? `var counter=0,borrowedEval=eval,borrowedFunction=Function;try{${effect}}catch{}` : "",
    );
  },
);

it.each([
  "counter=eval(7)",
  "counter=eval({value:7}).value",
  "counter=(function(){return 7})()",
  "counter=(function*(){yield 7})().next().value",
  "counter=typeof(async()=>7)==='function'?7:0",
  "eval=value=>value;counter=eval(7)",
  "Function=value=>value;counter=Function(7)",
  "counter=Number(JSON.stringify(7))",
  "try{JSON.parse('{')}catch(error){if(error.name!=='SyntaxError')throw error;counter=7}",
  "try{JSON.rawJSON('{')}catch(error){if(error.name!=='SyntaxError')throw error;counter=7}",
])("permits non-compiling control %s", async (effect) => {
  await withCheckpoint(effect, ({ api, agent, realm, resume }) => {
    let hooks = 0;
    agent.hostDefinedOptions.hostHooks = {
      HostEnsureCanCompileStrings: () => {
        hooks++;
        return api.NormalCompletion(undefined);
      },
    };
    expect(resume()).toHaveProperty("done", true);
    expect(hooks).toBe(0);
    expect(api.SameValue(getCounter(realm), api.Value(7))).toBe(true);
    expect(realm.GlobalObject.properties.get("caught")?.Value).toBe(api.Value.false);
    expect(realm.GlobalObject.properties.get("completed")?.Value).toBe(api.Value.true);
  });
});

it("preserves parameter/body coercion order before denying compilation, without rolling back coercion writes", async () => {
  await withCheckpoint(
    "Function({toString(){counter=counter*10+1;return 'parameter'}},{toString(){counter=counter*10+2;return 'return parameter'}})",
    ({ api, realm, resume }) => {
      expect(resume).toThrow(boundary);
      expect(api.SameValue(getCounter(realm), api.Value(12))).toBe(true);
    },
  );
});

it("preserves a guest coercion exception before the compile boundary", async () => {
  await withCheckpoint(
    "try { Function({toString(){counter++;throw 5}}) } catch(error) { if(error!==5) throw error; }",
    ({ api, realm, resume }) => {
      expect(resume()).toHaveProperty("done", true);
      expect(api.SameValue(getCounter(realm), api.Value(1))).toBe(true);
      expect(realm.GlobalObject.properties.get("caught")?.Value).toBe(api.Value.false);
    },
  );
});

it.each(
  ["parse-script", "parse-module", "compile-script", "compile-module"].flatMap((mode) =>
    [false, true].flatMap((invalid) =>
      [false, true].map((untracked) => ({ mode, invalid, untracked })),
    ),
  ),
)(
  "rejects $mode before options, parsing, stack changes or registrations, invalid=$invalid untracked=$untracked",
  async ({ mode, invalid, untracked }) => {
    await withCheckpoint("0", ({ api, agent, realm, release, resume }) => {
      const stack = [...agent.executionContextStack],
        sources = [...agent.parsedSources];
      const lastId = Number([...agent.parsedSources.keys()].at(-1));
      let options = 0,
        registrations = 0;
      agent.hostDefinedOptions.onScriptParsed = () => {
        registrations++;
      };
      const metadata = {
        get specifier() {
          options++;
          return "file:///blocked.js";
        },
        doNotTrackScriptId: untracked,
      };
      const source = invalid
        ? "export ="
        : mode.endsWith("module")
          ? "export const value=7"
          : "var value=7";
      const invoke = () => {
        if (mode === "parse-script") return api.ParseScript(source, realm, metadata);
        if (mode === "parse-module") return api.ParseModule(source, realm, metadata);
        if (mode === "compile-script") return realm.compileScript(source, metadata);
        return realm.compileModule(source, metadata);
      };
      expect(invoke).toThrow(boundary);
      expect(options).toBe(0);
      expect(registrations).toBe(0);
      expect(agent.executionContextStack.map((context, index) => context === stack[index])).toEqual(
        stack.map(() => true),
      );
      expect(
        [...agent.parsedSources].map(
          ([key, value], index) => key === sources[index]?.[0] && value === sources[index]?.[1],
        ),
      ).toEqual(sources.map(() => true));
      release();
      const compiled = api.ParseScript("void 0", realm);
      if (Array.isArray(compiled)) throw new Error("Expected script");
      expect(compiled.HostDefined.scriptId).toBe(String(lastId + 1));
      expect(registrations).toBe(1);
      expect(resume()).toHaveProperty("done", true);
    });
  },
);

it("rejects before a compile-hook property getter", async () => {
  await withCheckpoint("0", ({ api, agent, realm }) => {
    let reads = 0;
    Object.defineProperty(agent.hostDefinedOptions, "hostHooks", {
      configurable: true,
      get: () => {
        reads++;
        throw new Error("Hook getter");
      },
    });
    expect(() => api.skipDebugger(api.HostEnsureCanCompileStrings(realm, [], "0", false))).toThrow(
      boundary,
    );
    expect(reads).toBe(0);
  });
});

it("rejects compile requests from capture hooks without publishing a frame", async () => {
  await withAbstractFixture(({ agent, realm, compile, createBoolean }) => {
    createBoolean("enabled");
    agent.evaluate(compile("enabled?1:2"), () => {}, false);
    const pause = agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
    const stack = [...agent.executionContextStack],
      sources = [...agent.parsedSources];
    let captures = 0;
    expect(() =>
      agent.captureEvaluation({
        beginCapture: () => {
          realm.compileScript("var leaked=1");
        },
        capture: () => {
          captures++;
          return { restore: () => {} };
        },
      }),
    ).toThrow(boundary);
    expect(captures).toBe(0);
    expect(agent.resumeEvaluate({ pauseOnAbstractBoolean: true }).value).toBe(pause.value);
    expect(agent.executionContextStack.map((context, index) => context === stack[index])).toEqual(
      stack.map(() => true),
    );
    expect(
      [...agent.parsedSources].map(
        ([key, value], index) => key === sources[index]?.[0] && value === sources[index]?.[1],
      ),
    ).toEqual(sources.map(() => true));
    expect(() => agent.assertCanPerformHostEffect()).not.toThrow();
  });
});

it.each(["parsed", "dynamic", "cached-dynamic"])(
  "guards direct $s source registration and retains the next identifier",
  async (mode) => {
    await withCheckpoint(
      "0",
      ({ api, agent, realm, release }) => {
        const entry = [...agent.parsedSources.values()].find(
          (source) => source instanceof api.ScriptRecord,
        );
        if (!(entry instanceof api.ScriptRecord)) throw new Error("Expected script");
        const sources = [...agent.parsedSources],
          oldId = entry.HostDefined.scriptId;
        const lastId = Number([...agent.parsedSources.keys()].at(-1));
        let callbacks = 0;
        agent.hostDefinedOptions.onScriptParsed = () => {
          callbacks++;
        };
        const invoke = () =>
          mode === "parsed"
            ? agent.addParsedSource(entry)
            : agent.addDynamicParsedSource(
                realm,
                mode === "cached-dynamic" ? "0" : "never registered",
              );
        expect(invoke).toThrow(boundary);
        expect(callbacks).toBe(0);
        expect(entry.HostDefined.scriptId).toBe(oldId);
        expect(
          [...agent.parsedSources].map(
            ([key, value], index) => key === sources[index]?.[0] && value === sources[index]?.[1],
          ),
        ).toEqual(sources.map(() => true));
        release();
        expect(agent.addDynamicParsedSource(realm, "never registered")).toBe(String(lastId + 1));
        expect(agent.addDynamicParsedSource(realm, "never registered")).toBe(String(lastId + 1));
        expect(callbacks).toBe(1);
      },
      mode === "cached-dynamic" ? "eval('0')" : "",
    );
  },
);

it.each(["recipient", "surrounding"])(
  "guards the $s Agent for direct registry mutation",
  async (mode) => {
    await withCheckpoint("0", ({ api, agent, realm }) => {
      const foreign = new api.Agent({ startEventLoop: false });
      const entry = [...agent.parsedSources.values()].find(
        (source) => source instanceof api.ScriptRecord,
      );
      if (!(entry instanceof api.ScriptRecord)) throw new Error("Expected script");
      const recipient = mode === "recipient" ? agent : foreign;
      if (mode === "recipient") api.setSurroundingAgent(foreign);
      try {
        expect(() => recipient.addParsedSource(entry)).toThrow(boundary);
        expect(() => recipient.addDynamicParsedSource(realm, "blocked")).toThrow(boundary);
        expect(foreign.parsedSources.size).toBe(0);
      } finally {
        api.setSurroundingAgent(agent);
      }
    });
  },
);

it("keeps dynamic compilation available after releasing an unexecuted checkpoint", async () => {
  await withCheckpoint(
    "counter=Function('return 7')()",
    ({ api, agent, realm, release, resume }) => {
      let hooks = 0;
      agent.hostDefinedOptions.hostHooks = {
        HostEnsureCanCompileStrings: () => {
          hooks++;
          return api.NormalCompletion(undefined);
        },
      };
      release();
      expect(resume()).toHaveProperty("done", true);
      expect(hooks).toBe(1);
      expect(api.SameValue(getCounter(realm), api.Value(7))).toBe(true);
    },
  );
});

it("guards registry mutation before reading source metadata", async () => {
  await withCheckpoint("0", ({ agent }) => {
    let reads = 0;
    const source = {
      get HostDefined() {
        reads++;
        throw new Error("Source getter");
      },
    };
    expect(() => Reflect.apply(agent.addParsedSource, agent, [source])).toThrow(boundary);
    expect(reads).toBe(0);
  });
});

it.each(["script", "module"])(
  "guards the %s compile wrapper before looking up its context helper",
  async (kind) => {
    await withCheckpoint("0", ({ realm }) => {
      let reads = 0;
      Object.defineProperty(realm, "pushTopContext", {
        configurable: true,
        get: () => {
          reads++;
          throw new Error("Context getter");
        },
      });
      try {
        expect(() =>
          kind === "script" ? realm.compileScript("0") : realm.compileModule(""),
        ).toThrow(boundary);
        expect(reads).toBe(0);
      } finally {
        Reflect.deleteProperty(realm, "pushTopContext");
      }
    });
  },
);

it.each(["capture", "restore"])("guards direct compilation during owner %s", async (phase) => {
  await withAbstractFixture(({ api, agent, realm, compile, createBoolean }) => {
    createBoolean("enabled");
    agent.evaluate(compile("enabled?1:2"), () => {}, false);
    agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
    const size = agent.parsedSources.size;
    const capture = () =>
      agent.captureEvaluation({
        capture: () => {
          if (phase === "capture") api.ParseScript("0", realm);
          return {
            restore: () => {
              api.ParseModule("export const value=1", realm);
            },
          };
        },
      });
    if (phase === "capture") expect(capture).toThrow(boundary);
    else {
      const saved = capture();
      try {
        const failure = getFailure(saved.restore);
        expect(failure).toHaveProperty("message", boundary);
        expect(getFailure(saved.restore)).toBe(failure);
        expect(getFailure(() => agent.resumeEvaluate())).toBe(failure);
      } finally {
        saved.release();
      }
    }
    expect(agent.parsedSources.size).toBe(size);
    expect(() => agent.assertCanPerformHostEffect()).not.toThrow();
  });
});

it("keeps compilation blocked after terminal completion until the checkpoint is released", async () => {
  await withCheckpoint("0", ({ api, realm, resume, release }) => {
    expect(resume()).toHaveProperty("done", true);
    expect(() => realm.compileScript("void 0")).toThrow(boundary);
    release();
    expect(api.EnsureCompletion(realm.compileScript("void 0")).Type).toBe("normal");
  });
});

it.each(
  ["ParseJSON", "ParseJSONModule"].flatMap((method) =>
    [false, true].map((invalid) => ({ method, invalid })),
  ),
)(
  "accounts for $method using Script parsing after JSON validation, invalid=$invalid",
  async ({ method, invalid }) => {
    await withCheckpoint("0", ({ api, agent, resume }) => {
      const sources = [...agent.parsedSources];
      const parseJSON = api
        .getNativeCaptures(api.ParseJSONModule)
        ?.bindings.find((binding) => binding.name === "ParseJSON")
        ?.get();
      if (typeof parseJSON !== "function") throw new Error("Expected private ParseJSON binding");
      const parse = () =>
        method === "ParseJSON"
          ? Reflect.apply(parseJSON, undefined, [invalid ? "{" : "7"])
          : api.ParseJSONModule(invalid ? "{" : "7");
      if (invalid) expect(api.EnsureCompletion(parse()).Type).toBe("throw");
      else expect(parse).toThrow(boundary);
      expect(
        [...agent.parsedSources].map(
          ([key, value], index) => key === sources[index]?.[0] && value === sources[index]?.[1],
        ),
      ).toEqual(sources.map(() => true));
      expect(resume()).toHaveProperty("done", true);
    });
  },
);
