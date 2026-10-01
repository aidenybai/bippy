import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import type { StateCheckpoint } from "../engine/dist/declaration/index.mjs";
import { withAbstractFixture } from "./helpers/abstract-fixture.js";
import { withFixture } from "./helpers/engine-fixture.js";

it("restores context fields and original CallSite identities, including copy omissions", async () => {
  await withFixture(({ api, realm, evaluate, getObject }) => {
    evaluate(`
      var generator = (function* () { yield 1; yield 2; })();
      var originalFunction = () => 1;
    `);
    const context = new api.ExecutionContext();
    context.Realm = realm;
    context.LexicalEnvironment = realm.GlobalEnv;
    context.VariableEnvironment = realm.GlobalEnv;
    const originalFunction = getObject("originalFunction");
    if (!api.isFunctionObject(originalFunction)) throw Error("Expected function");
    context.Function = originalFunction;
    const generator = getObject("generator");
    Object.defineProperty(context, "Generator", {
      value: generator,
      writable: true,
      enumerable: true,
      configurable: true,
    });
    context.HostDefined = { scriptId: "saved" };
    context.HostCapturedValues = [originalFunction];
    context.poppedForTailCall = true;
    const callSite = context.callSite;
    const script = api.EnsureCompletion(realm.compileScript("void 1"));
    if (script.Type !== "normal") throw Error("Expected script");
    callSite.nextNode = script.Value.ECMAScriptCode;
    const original = Object.getOwnPropertyDescriptors(context);
    const originalSite = Object.getOwnPropertyDescriptors(callSite);
    const checkpoint = api.createStateCheckpoint({
      contexts: [context, context],
      callSites: [callSite],
    });
    try {
      expect(checkpoint.contextCount).toBe(1);
      expect(checkpoint.callSiteCount).toBe(1);
      context.Function = api.Value.null;
      context.LexicalEnvironment = new api.DeclarativeEnvironmentRecord(null);
      context.VariableEnvironment = context.LexicalEnvironment;
      context.HostDefined = undefined;
      context.HostCapturedValues = undefined;
      context.Generator = undefined;
      context.poppedForTailCall = false;
      callSite.nextNode = null;
      callSite.constructCall = true;
      checkpoint.restore();
      for (const [name, descriptor] of Object.entries(original))
        expect(Object.getOwnPropertyDescriptor(context, name)?.value).toBe(descriptor.value);
      for (const [name, descriptor] of Object.entries(originalSite))
        expect(Object.getOwnPropertyDescriptor(callSite, name)?.value).toBe(descriptor.value);
      expect(context.callSite).toBe(callSite);
      expect(callSite.context).toBe(context);
    } finally {
      checkpoint.release();
    }
  });
});

it("preserves the existing async-copy defaults while supporting in-place targets", async () => {
  await withFixture(({ api, realm }) => {
    const context = new api.ExecutionContext();
    context.Realm = realm;
    context.poppedForTailCall = true;
    const script = api.EnsureCompletion(realm.compileScript("void 1"));
    if (script.Type !== "normal") throw Error("Expected script");
    context.callSite.nextNode = script.Value.ECMAScriptCode;
    const copy = context.copy();
    expect(copy).not.toBe(context);
    expect(copy.Realm).toBe(realm);
    expect(copy.poppedForTailCall).toBe(false);
    expect(copy.callSite.nextNode).toBeNull();
    const target = new api.ExecutionContext();
    const originalSite = target.callSite;
    expect(context.copy(target)).toBe(target);
    expect(target.callSite).toBe(originalSite);
    expect(target.callSite.context).toBe(target);
  });
});

it("selects a detached CallSite and its context, with shared storage deduplication", async () => {
  await withFixture(({ api, realm }) => {
    const context = new api.ExecutionContext();
    context.Realm = realm;
    const originalSite = context.callSite;
    const detached = originalSite.clone();
    const checkpoint = api.createStateCheckpoint({
      contexts: [context],
      callSites: [detached, originalSite, detached],
    });
    expect(checkpoint.contextCount).toBe(1);
    expect(checkpoint.callSiteCount).toBe(2);
    context.poppedForTailCall = true;
    detached.constructCall = true;
    originalSite.constructCall = true;
    checkpoint.restore();
    expect(context.poppedForTailCall).toBe(false);
    expect(detached.constructCall).toBe(false);
    expect(originalSite.constructCall).toBe(false);
    expect(detached.context).toBe(context);
    checkpoint.release();
  });
});

it("does not rewind referenced host metadata, environments or generator positions", async () => {
  await withFixture(({ api, realm, evaluate, getObject, readString }) => {
    evaluate(`
      let retained = 1;
      var generator = (function* () { yield 1; yield 2; })();
    `);
    const context = new api.ExecutionContext();
    context.Realm = realm;
    context.LexicalEnvironment = realm.GlobalEnv.DeclarativeRecord;
    context.HostDefined = { scriptId: "before" };
    Object.defineProperty(context, "Generator", {
      value: getObject("generator"),
      writable: true,
      enumerable: true,
      configurable: true,
    });
    const checkpoint = api.createStateCheckpoint({ contexts: [context] });
    evaluate(`
      retained = 2;
      generator.next();
    `);
    context.HostDefined.scriptId = "after";
    checkpoint.restore();
    expect(context.HostDefined.scriptId).toBe("after");
    expect(readString("JSON.stringify([retained, generator.next().value])")).toBe("[2,2]");
    checkpoint.release();
  });
});

it.each(["extra", "accessor", "frozen", "site-owner", "site-identity"])(
  "preflights changed %s before any writes",
  async (change) => {
    await withFixture(({ api, realm, evaluate, getObject, readString }) => {
      evaluate("var extra = { value: 1 }");
      const context = new api.ExecutionContext();
      context.Realm = realm;
      const checkpoint = api.createStateCheckpoint({
        objects: [getObject("extra")],
        contexts: [context],
      });
      evaluate("extra.value = 2");
      let getterCalls = 0;
      if (change === "extra")
        Object.defineProperty(context, "unexpected", { value: 1, configurable: true });
      if (change === "accessor")
        Object.defineProperty(context, "HostDefined", {
          configurable: true,
          get: () => {
            getterCalls++;
            return undefined;
          },
        });
      if (change === "frozen") Object.freeze(context);
      if (change === "site-owner") context.callSite.context = new api.ExecutionContext();
      if (change === "site-identity") context.callSite = new api.CallSite(context);
      expect(() => checkpoint.restore()).toThrow(
        change === "site-owner"
          ? "Checkpoint context CallSite owner changed"
          : change === "site-identity"
            ? "Checkpoint context CallSite identity changed"
            : "Checkpoint requires canonical context records",
      );
      expect(getterCalls).toBe(0);
      expect(readString("JSON.stringify(extra.value)")).toBe("2");
      checkpoint.release();
    });
  },
);

it("rejects accessor CallSite metadata before capture without registering a frame", async () => {
  await withFixture(({ api, realm }) => {
    const context = new api.ExecutionContext();
    context.Realm = realm;
    const parent = api.createStateCheckpoint({ contexts: [context] });
    const detached = context.callSite.clone();
    let getterCalls = 0;
    Object.defineProperty(detached, "context", {
      configurable: true,
      get: () => {
        getterCalls++;
        return context;
      },
    });
    expect(() => api.createStateCheckpoint({ callSites: [detached] })).toThrow(
      "Checkpoint requires canonical context records",
    );
    expect(getterCalls).toBe(0);
    parent.restore();
    parent.release();
  });
});

it("rejects foreign contexts and preserves shared LIFO and preview guards", async () => {
  await withFixture(({ api, realm }) => {
    const context = new api.ExecutionContext();
    context.Realm = realm;
    const parent = api.createStateCheckpoint({ contexts: [context] });
    const child = api.createStateCheckpoint({ callSites: [context.callSite] });
    expect(() => parent.restore()).toThrow("last-in-first-out");
    child.release();
    api.surroundingAgent.debugger_scopePreview(() => {
      expect(() => parent.restore()).toThrow("Context checkpoints do not support debugger preview");
      expect(() => api.createStateCheckpoint({ contexts: [context] })).toThrow(
        "Context checkpoints do not support debugger preview",
      );
    });
    const owner = api.surroundingAgent;
    api.setSurroundingAgent(new api.Agent({ startEventLoop: false }));
    try {
      expect(() => parent.restore()).toThrow("belongs to another agent");
      expect(() => api.createStateCheckpoint({ contexts: [context] })).toThrow(
        "Checkpoint contexts must belong to the current agent",
      );
    } finally {
      api.setSurroundingAgent(owner);
    }
    parent.restore();
    parent.release();
    expect(() => parent.restore()).toThrow("released");
  });
});

it("roots saved context references until release", async () => {
  await withFixture(({ api, realm, evaluate, getObject, readString }) => {
    evaluate(`
      var saved = () => 7;
      var reference = new WeakRef(saved);
    `);
    const context = new api.ExecutionContext();
    context.Realm = realm;
    const saved = getObject("saved");
    if (!api.isFunctionObject(saved)) throw Error("Expected function");
    context.Function = saved;
    evaluate("saved = null");
    const checkpoint = api.createStateCheckpoint({ contexts: [context] });
    context.Function = api.Value.null;
    api.surroundingAgent.AgentRecord.KeptAlive.clear();
    api.gc();
    expect(readString("JSON.stringify(reference.deref()())")).toBe("7");
    checkpoint.restore();
    expect(context.Function).toBe(saved);
    context.Function = api.Value.null;
    checkpoint.release();
    api.surroundingAgent.AgentRecord.KeptAlive.clear();
    api.gc();
    expect(readString("JSON.stringify(reference.deref() === undefined)")).toBe("true");
  });
});

it.each([false, true])(
  "restores real context fields around a scoped branch, reversed=%s",
  async (isReversed) => {
    await withAbstractFixture(({ api, agent, evaluate, compile, createBoolean }) => {
      evaluate("var observation");
      createBoolean("enabled");
      const source = `
      {
        let retained = "prefix";
        void 1;
        try {
          if (enabled) {
            let branchValue = "left";
            observation = retained + ":" + branchValue;
            throw "caught";
          }
          let branchValue = "right";
          observation = retained + ":" + branchValue;
        } catch (error) {
          observation += ":" + error;
        } finally {
          observation += ":done";
        }
        JSON.stringify(observation);
      }
    `;
      let prefixCount = 0;
      agent.hostDefinedOptions.onNodeEvaluation = (node) => {
        if (node.type === "UnaryExpression" && node.sourceText === "void 1") prefixCount++;
      };
      agent.evaluate(compile(source), () => {}, false);
      const pause = agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
      if (pause.done || !pause.value) throw Error("Expected decision");
      const contexts = [...agent.executionContextStack];
      let storage: StateCheckpoint | undefined;
      const checkpoint = agent.captureEvaluation({
        capture: () => {
          const state = api.createStateCheckpoint({ contexts });
          storage = state;
          return {
            restore: () => {
              state.restore();
              agent.executionContextStack.splice(
                0,
                agent.executionContextStack.length,
                ...contexts,
              );
            },
          };
        },
      });
      try {
        for (const enabled of isReversed ? [true, false] : [false, true]) {
          checkpoint.restore();
          agent.AgentRecord.KeptAlive.clear();
          api.gc();
          const result = agent.resumeEvaluate({
            abstractBooleanDecision: {
              resume: "abstract-boolean",
              decision: pause.value,
              value: enabled,
            },
          });
          if (!result.done) throw Error("Expected completion");
          const completion = api.EnsureCompletion(result.value);
          if (!(completion.Value instanceof api.JSStringValue)) throw Error("Expected observation");
          expect(completion.Value.stringValue()).toBe(runInNewContext(source, { enabled }));
        }
      } finally {
        checkpoint.release();
        storage?.release();
      }
      expect(prefixCount).toBe(1);
    });
  },
);
