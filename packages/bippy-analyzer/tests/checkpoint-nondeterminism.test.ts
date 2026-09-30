import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import type { EvaluationCheckpoint } from "../engine/dist/declaration/index.mjs";
import { withAbstractFixture, type AbstractFixture } from "./helpers/abstract-fixture.js";

interface NondeterminismFixture extends AbstractFixture {
  checkpoint: EvaluationCheckpoint;
  resume: () => unknown;
  getClockReads: () => number;
  getSeedReads: () => number;
}

const withCheckpoint = async (
  effect: string,
  warm: boolean,
  run: (fixture: NondeterminismFixture) => void,
) => {
  await withAbstractFixture((fixture) => {
    const { api, agent, realm, createBoolean, compile, evaluate } = fixture;
    let clocks = 0,
      seeds = 0;
    agent.hostDefinedOptions.hostHooks = {
      HostSystemUTCEpochNanoseconds: () => {
        clocks++;
        return api.MinEpochNanoseconds;
      },
    };
    Object.defineProperty(realm.HostDefined, "randomSeed", {
      get: () => {
        seeds++;
        return () => "123";
      },
      configurable: true,
    });
    if (warm) expect(evaluate("Math.random()").Type).toBe("normal");
    clocks = seeds = 0;
    createBoolean("enabled");
    agent.evaluate(
      compile(`
      var caught = false, completed = false;
      var borrowedRandom = Math.random, borrowedClock = Date.now;
      if (enabled) {
        try { ${effect}; } catch (error) { caught = true; }
        completed = true;
      }
    `),
      () => {},
      false,
    );
    const pause = agent.resumeEvaluate({ pauseOnAbstractBoolean: true, noBreakpoint: true });
    if (pause.done || !pause.value) throw Error("Expected decision");
    const decision = pause.value;
    const checkpoint = agent.captureEvaluation({ capture: () => ({ restore: () => {} }) });
    try {
      run({
        ...fixture,
        checkpoint,
        getClockReads: () => clocks,
        getSeedReads: () => seeds,
        resume: () =>
          agent.resumeEvaluate({
            abstractBooleanDecision: {
              resume: "abstract-boolean",
              decision,
              value: true,
            },
            noBreakpoint: true,
          }),
      });
    } finally {
      checkpoint.release();
    }
  });
};

it.each(
  [
    "Date.now()",
    "new Date()",
    "Date()",
    "borrowedClock.call(null)",
    "Math.random()",
    "borrowedRandom.call(null)",
  ].flatMap((effect) => [false, true].map((warm) => ({ effect, warm }))),
)(
  "rejects $effect before observing time or advancing random state, warm=$warm",
  async ({ effect, warm }) => {
    await withCheckpoint(
      effect,
      warm,
      ({ api, realm, checkpoint, resume, getClockReads, getSeedReads }) => {
        const state = realm.randomState;
        const values = state && [...state];
        let failure: unknown;
        try {
          resume();
        } catch (error) {
          failure = error;
        }
        expect(failure).toBeInstanceOf(TypeError);
        expect(failure).toHaveProperty(
          "message",
          "Host effects are unsupported during evaluation checkpoints",
        );
        expect(getClockReads()).toBe(0);
        expect(getSeedReads()).toBe(0);
        expect(realm.randomState).toBe(state);
        expect(state && [...state]).toEqual(values);
        expect(realm.GlobalObject.properties.get("caught")?.Value).toBe(api.Value.false);
        expect(realm.GlobalObject.properties.get("completed")?.Value).toBe(api.Value.false);
        for (const retry of [resume, checkpoint.restore]) {
          let repeated: unknown;
          try {
            retry();
          } catch (error) {
            repeated = error;
          }
          expect(repeated).toBe(failure);
        }
      },
    );
  },
);

it("rejects default entropy before allocating Realm random state", async () => {
  await withCheckpoint("Math.random()", false, ({ realm, resume }) => {
    Reflect.deleteProperty(realm.HostDefined, "randomSeed");
    expect(realm.randomState).toBeUndefined();
    expect(resume).toThrow("Host effects are unsupported during evaluation checkpoints");
    expect(realm.randomState).toBeUndefined();
  });
});

it("rejects before looking up a host clock hook", async () => {
  await withCheckpoint("Date.now()", false, ({ agent, resume }) => {
    let reads = 0;
    const hooks = agent.hostDefinedOptions.hostHooks;
    if (!hooks) throw Error("Expected hooks");
    Object.defineProperty(hooks, "HostSystemUTCEpochNanoseconds", {
      get: () => {
        reads++;
        throw Error("Clock hook lookup");
      },
    });
    expect(resume).toThrow("Host effects are unsupported during evaluation checkpoints");
    expect(reads).toBe(0);
  });
});

it("guards direct clock entry points and permits them again after release", async () => {
  await withAbstractFixture(({ api, agent, realm, compile, createBoolean }) => {
    let calls = 0;
    agent.hostDefinedOptions.hostHooks = {
      HostSystemUTCEpochNanoseconds: () => {
        calls++;
        return api.MinEpochNanoseconds;
      },
    };
    createBoolean("enabled");
    agent.evaluate(compile("if (enabled) void 0"), () => {}, false);
    const pause = agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
    if (pause.done || !pause.value) throw Error("Expected decision");
    const saved = agent.captureEvaluation({ capture: () => ({ restore: () => {} }) });
    try {
      for (const read of [
        () => api.HostSystemUTCEpochNanoseconds(realm.GlobalObject),
        () => api.SystemUTCEpochMilliseconds(),
        () => api.SystemUTCEpochNanoseconds(),
      ]) {
        expect(read).toThrow("Host effects are unsupported during evaluation checkpoints");
      }
      expect(calls).toBe(0);
    } finally {
      saved.release();
    }
    expect(api.HostSystemUTCEpochNanoseconds(realm.GlobalObject)).toBe(api.MinEpochNanoseconds);
    expect(calls).toBe(1);
    expect(
      agent.resumeEvaluate({
        abstractBooleanDecision: {
          resume: "abstract-boolean",
          decision: pause.value,
          value: false,
        },
      }).done,
    ).toBe(true);
  });
});

it.each(["capture", "restore"])(
  "rejects clock access inside the owner during %s",
  async (phase) => {
    await withAbstractFixture(({ api, agent, realm, compile, createBoolean }) => {
      let calls = 0;
      agent.hostDefinedOptions.hostHooks = {
        HostSystemUTCEpochNanoseconds: () => {
          calls++;
          return api.MinEpochNanoseconds;
        },
      };
      createBoolean("enabled");
      agent.evaluate(compile("if (enabled) void 0"), () => {}, false);
      const pause = agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
      if (pause.done || !pause.value) throw Error("Expected decision");
      const read = () => api.HostSystemUTCEpochNanoseconds(realm.GlobalObject);
      if (phase === "capture") {
        expect(() =>
          agent.captureEvaluation({
            capture: () => {
              read();
              return { restore: () => {} };
            },
          }),
        ).toThrow("Host effects are unsupported during evaluation checkpoints");
        const saved = agent.captureEvaluation({ capture: () => ({ restore: () => {} }) });
        saved.release();
        expect(
          agent.resumeEvaluate({
            abstractBooleanDecision: {
              resume: "abstract-boolean",
              decision: pause.value,
              value: false,
            },
          }).done,
        ).toBe(true);
      } else {
        const saved = agent.captureEvaluation({ capture: () => ({ restore: read }) });
        try {
          expect(() => saved.restore()).toThrow(
            "Host effects are unsupported during evaluation checkpoints",
          );
        } finally {
          saved.release();
        }
      }
      expect(calls).toBe(0);
    });
  },
);

it("permits explicit date conversion and ordinary guest replacements during a checkpoint", async () => {
  const source = `
    Math.random = () => 0.25;
    Date.now = () => 123;
    if (enabled) JSON.stringify([new Date(0).toISOString(), Date.UTC(2000,0,1), Date.parse("2000-01-01T00:00:00.000Z"), Math.random(), Date.now()]);
  `;
  await withAbstractFixture(({ api, agent, compile, createBoolean }) => {
    createBoolean("enabled");
    let actual;
    agent.evaluate(
      compile(source),
      (completion) => {
        if (!(completion.Value instanceof api.JSStringValue)) throw Error("Expected string");
        actual = completion.Value.stringValue();
      },
      false,
    );
    const pause = agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
    if (pause.done || !pause.value) throw Error("Expected decision");
    const saved = agent.captureEvaluation({ capture: () => ({ restore: () => {} }) });
    try {
      expect(
        agent.resumeEvaluate({
          abstractBooleanDecision: {
            resume: "abstract-boolean",
            decision: pause.value,
            value: true,
          },
        }).done,
      ).toBe(true);
      expect(actual).toBe(runInNewContext(source, { enabled: true }));
    } finally {
      saved.release();
    }
  });
});

it("leaves ordinary seeded random execution unchanged outside evaluation checkpoints", async () => {
  const observations: string[] = [];
  for (let index = 0; index < 2; index++) {
    await withAbstractFixture(({ api, realm, evaluate }) => {
      realm.HostDefined.randomSeed = () => "123";
      const result = evaluate("JSON.stringify([Math.random(), Math.random(), Math.random()])");
      if (!(result.Value instanceof api.JSStringValue)) throw Error("Expected string");
      observations.push(result.Value.stringValue());
    });
  }
  expect(observations[0]).toBe(observations[1]);
  expect(new Set(JSON.parse(observations[0])).size).toBe(3);
});
