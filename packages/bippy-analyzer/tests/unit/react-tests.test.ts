import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import type { AnalyzedComponent } from "../../src/core/types";
import type { Observation } from "../conformance/verifier/driver";
import { collectHandlerProbes } from "../conformance/verifier/handler-probes";
import { scoreComponent } from "../conformance/verifier/score";
import type { Action, Capture, Shape } from "../conformance/verifier/types";
import { analyzeFixture, getComponent } from "./helpers";

interface Step {
  action: string;
  fired: string[];
  html: string;
  hookStates: unknown[];
}

interface Script {
  component: string;
  html: string;
  hookStates: unknown[];
  steps: Step[];
}

interface PortedTest {
  source: string;
  file: string;
  script: Script;
  gap?: string;
}

const TAG_PATTERN = /<(\/?)([A-Za-z][\w-]*)\s*(\/?)>|[^<]+/g;

const parseHtml = (html: string): Shape[] => {
  const root: Shape[] = [];
  const stack: Shape[][] = [root];
  for (const [token, closing, tag, selfClosing] of html.matchAll(TAG_PATTERN)) {
    const siblings = stack.at(-1);
    if (!siblings) break;
    if (tag === undefined) {
      if (token.trim()) siblings.push({ kind: "text", text: token.trim() });
      continue;
    }
    if (closing) {
      stack.pop();
      continue;
    }
    if (/^[A-Z]/.test(tag)) {
      siblings.push({ kind: "component", name: tag });
      continue;
    }
    const children: Shape[] = [];
    siblings.push({ kind: "element", tag, children });
    if (!selfClosing) stack.push(children);
  }
  return root;
};

const createCapture = (html: string, hookStates: unknown[], handlerHits: string[]): Capture => ({
  shapes: parseHtml(html),
  hookStates,
  probes: [],
  handlerHits,
  mutationHits: [],
  mutatedOwners: [],
  firstCommitShapes: null,
  error: null,
  errorDepth: null,
  failure: null,
});

const EVENT_NAME_PATTERN = /^on[A-Z]\w*$/;

const getFiredProbeIds = (component: AnalyzedComponent, fired: string[]): string[] => {
  const handlersById = new Map(component.analysis.handlers.map((handler) => [handler.id, handler]));
  const probes = collectHandlerProbes(component.analysis).map(({ probe, handlerId }) => {
    const trigger = handlersById.get(handlerId)?.trigger;
    return {
      id: probe.id,
      event: trigger?.kind === "Event" ? trigger.event : null,
      source: readFileSync(probe.file, "utf8").slice(probe.start, probe.end),
    };
  });
  return fired.map((handler) => {
    const matching = probes.filter((probe) =>
      EVENT_NAME_PATTERN.test(handler) ? probe.event === handler : probe.source.startsWith(handler),
    );
    if (matching.length > 1) throw new Error(`${matching.length} handlers match ${handler}`);
    return matching[0]?.id ?? `unmodeled:${handler}`;
  });
};

const getObservations = (component: AnalyzedComponent, script: Script): Observation[] => {
  const mount: Observation = {
    props: {},
    path: [],
    action: null,
    before: null,
    after: createCapture(script.html, script.hookStates, []),
  };
  return script.steps.reduce<Observation[]>(
    (observations, step) => {
      const previous = observations.at(-1) ?? mount;
      const action: Action = {
        key: step.action,
        kind: "click",
        tag: "button",
        label: step.action,
        isInChild: false,
      };
      return [
        ...observations,
        {
          props: {},
          path: [...previous.path, step.action],
          action,
          before: previous.after,
          after: createCapture(step.html, step.hookStates, getFiredProbeIds(component, step.fired)),
        },
      ];
    },
    [mount],
  );
};

const getCounterexamples = (fixtureFile: string, script: Script): string[] => {
  const component = getComponent(analyzeFixture("react-tests", fixtureFile), script.component);
  const verdict = scoreComponent(
    component.analysis,
    component.report,
    getObservations(component, script),
    new Map(),
  );
  return [
    ...verdict.stateCounterexamples.map(
      (counterexample) =>
        `no state renders ${counterexample.rendered} after ${counterexample.path.join(" → ") || "mount"}`,
    ),
    ...verdict.transitionCounterexamples.map(
      (counterexample) =>
        `${counterexample.action} goes from ${counterexample.fromStates.join(",")} to ${counterexample.toStates.join(",")}, predicted ${counterexample.predictedStates.join(",")} (${counterexample.reason})`,
    ),
    ...verdict.valueCounterexamples.map(
      (counterexample) =>
        `${counterexample.place} is ${counterexample.value} after ${counterexample.path.join(" → ") || "mount"}, predicted ${counterexample.predicted.join(" | ")}`,
    ),
    ...verdict.reachedUnreachableBranches.map((branch) => `reached unreachable ${branch}`),
  ];
};

const describePorts = (title: string, ports: PortedTest[]): void => {
  describe(title, () => {
    for (const { source, file, script, gap } of ports) {
      const name = `${source} (${script.component})`;
      if (gap) {
        it.fails(`${name}: ${gap}`, () => {
          expect(getCounterexamples(file, script)).toEqual([]);
        });
        continue;
      }
      it(name, () => {
        expect(getCounterexamples(file, script)).toEqual([]);
      });
    }
  });
};

describePorts("ReactDOMEventPropagation-test.js > ReactDOMEventListener", [
  {
    source: "after bubbling events > onClick > testNativeBubblingEventWithTargetListener",
    file: "event-propagation",
    script: {
      component: "ClickBubblesToParent",
      html: "<div><button>target</button><p>inner idle</p><p>outer idle</p></div>",
      hookStates: ["idle", "idle"],
      steps: [
        {
          action: "target",
          fired: ["() => setInner", "() => setOuter"],
          html: "<div><button>target</button><p>inner clicked</p><p>outer clicked</p></div>",
          hookStates: ["clicked", "clicked"],
        },
      ],
    },
  },
  {
    source: "after bubbling events > onClick > testNativeBubblingEventWithTargetListener",
    file: "event-propagation",
    script: {
      component: "CaptureBeforeTargetBeforeBubble",
      html: "<div><button>target</button><p>idle</p></div>",
      hookStates: ["idle"],
      steps: [
        {
          action: "target",
          fired: [
            "onClickCapture",
            '() => setPhase((current) => (current === "capture"',
            '() => setPhase((current) => (current === "target"',
          ],
          html: "<div><button>target</button><p>bubble</p></div>",
          hookStates: ["bubble"],
        },
      ],
    },
  },
  {
    source: "after bubbling events > onClick > testReactStopPropagationInInnerBubblePhase",
    file: "event-propagation",
    script: {
      component: "StopPropagationInTarget",
      html: "<div><button>target</button><p>inner idle</p><p>outer idle</p></div>",
      hookStates: ["idle", "idle"],
      steps: [
        {
          action: "target",
          fired: ["(event) =>"],
          html: "<div><button>target</button><p>inner clicked</p><p>outer idle</p></div>",
          hookStates: ["clicked", "idle"],
        },
      ],
    },
  },
  {
    source: "after bubbling events > onClick > testReactStopPropagationInOuterCapturePhase",
    file: "event-propagation",
    script: {
      component: "StopPropagationInOuterCapture",
      html: "<div><button>target</button><p>inner idle</p><p>outer idle</p></div>",
      hookStates: ["idle", "idle"],
      steps: [
        {
          action: "target",
          fired: ["onClickCapture"],
          html: "<div><button>target</button><p>inner idle</p><p>outer clicked</p></div>",
          hookStates: ["idle", "clicked"],
        },
      ],
    },
  },
  {
    source: "after bubbling events > onClick > testNativeBubblingEventWithoutTargetListener",
    file: "event-propagation",
    script: {
      component: "ClickOnChildWithoutListener",
      html: "<div><span>label</span><p>none</p></div>",
      hookStates: [0],
      steps: [
        {
          action: "label",
          fired: ["onClick"],
          html: "<div><span>label</span><p>one</p></div>",
          hookStates: [1],
        },
      ],
    },
  },
]);

describePorts("ReactDOMForm-test.js > ReactDOMForm", [
  {
    source: "after should allow passing a function to an input/button formAction",
    file: "event-propagation",
    script: {
      component: "SubmitButtonSubmitsForm",
      html: "<form><button>send</button><p>draft</p></form>",
      hookStates: [false],
      steps: [
        {
          action: "send",
          fired: ["onSubmit"],
          html: "<form><button>send</button><p>sent</p></form>",
          hookStates: [true],
        },
      ],
    },
  },
]);

describePorts("ReactUpdates-test.js > ReactUpdates", [
  {
    source: "after should batch state when updating state twice",
    file: "update-queues",
    script: {
      component: "BatchesStateTwice",
      html: "<div><button>twice</button><p>zero</p></div>",
      hookStates: [0],
      steps: [
        {
          action: "twice",
          fired: ["onClick"],
          html: "<div><button>twice</button><p>two</p></div>",
          hookStates: [2],
        },
        {
          action: "twice",
          fired: ["onClick"],
          html: "<div><button>twice</button><p>four</p></div>",
          hookStates: [4],
        },
      ],
    },
  },
  {
    source: "after should batch state when updating state twice",
    file: "update-queues",
    script: {
      component: "StaleValueSetTwice",
      html: "<div><button>twice</button><p>zero</p></div>",
      hookStates: [0],
      steps: [
        {
          action: "twice",
          fired: ["onClick"],
          html: "<div><button>twice</button><p>one</p></div>",
          hookStates: [1],
        },
        {
          action: "twice",
          fired: ["onClick"],
          html: "<div><button>twice</button><p>two</p></div>",
          hookStates: [2],
        },
      ],
    },
  },
  {
    source: "should batch state when updating two different states",
    file: "update-queues",
    script: {
      component: "BatchesTwoStates",
      html: "<div><button>both</button><p>left zero</p><p>right zero</p></div>",
      hookStates: [0, 0],
      steps: [
        {
          action: "both",
          fired: ["onClick"],
          html: "<div><button>both</button><p>left one</p><p>right two</p></div>",
          hookStates: [1, 2],
        },
      ],
    },
  },
]);

describePorts("ReactIncrementalUpdates-test.js > ReactIncrementalUpdates", [
  {
    source: "after passes accumulation of previous updates to replaceState updater function",
    file: "update-queues",
    script: {
      component: "UpdaterAfterReplacement",
      html: "<div><button>replace then add</button><p>zero</p></div>",
      hookStates: [0],
      steps: [
        {
          action: "replace then add",
          fired: ["onClick"],
          html: "<div><button>replace then add</button><p>six</p></div>",
          hookStates: [6],
        },
      ],
    },
  },
  {
    source: "after applies updates with equal priority in insertion order",
    file: "update-queues",
    script: {
      component: "ReplacementAfterUpdater",
      html: "<div><button>add then replace</button><p>zero</p></div>",
      hookStates: [0],
      steps: [
        {
          action: "add then replace",
          fired: ["onClick"],
          html: "<div><button>add then replace</button><p>ten</p></div>",
          hookStates: [10],
        },
      ],
    },
  },
]);

describePorts("ReactHooksWithNoopRenderer-test.js > ReactHooksWithNoopRenderer", [
  {
    source: "useState > simple mount and update",
    file: "update-queues",
    script: {
      component: "SimpleMountAndUpdate",
      html: "<div><button>one</button><button>add ten</button><p>zero</p></div>",
      hookStates: [0],
      steps: [
        {
          action: "one",
          fired: ["() => setCount(1)"],
          html: "<div><button>one</button><button>add ten</button><p>one</p></div>",
          hookStates: [1],
        },
        {
          action: "add ten",
          fired: ["() => setCount((current)"],
          html: "<div><button>one</button><button>add ten</button><p>eleven</p></div>",
          hookStates: [11],
        },
      ],
    },
  },
  {
    source: "useState > lazy state initializer",
    file: "update-queues",
    script: {
      component: "LazyStateInitializer",
      html: "<div><button>seven</button><p>forty-two</p></div>",
      hookStates: [42],
      steps: [
        {
          action: "seven",
          fired: ["onClick"],
          html: "<div><button>seven</button><p>seven</p></div>",
          hookStates: [7],
        },
      ],
    },
  },
  {
    source: "useState > multiple states",
    file: "update-queues",
    script: {
      component: "MultipleStates",
      html: "<div><button>seven</button><button>total</button><p>Count</p><p>zero</p></div>",
      hookStates: [0, "Count"],
      steps: [
        {
          action: "seven",
          fired: ["() => setCount"],
          html: "<div><button>seven</button><button>total</button><p>Count</p><p>seven</p></div>",
          hookStates: [7, "Count"],
        },
        {
          action: "total",
          fired: ["() => setLabel"],
          html: "<div><button>seven</button><button>total</button><p>Total</p><p>seven</p></div>",
          hookStates: [7, "Total"],
        },
      ],
    },
  },
  {
    source: "useReducer > simple mount and update",
    file: "update-queues",
    script: {
      component: "ReducerMountAndUpdate",
      html: "<div><button>increment</button><button>decrement three times</button><p>zero</p></div>",
      hookStates: [0],
      steps: [
        {
          action: "increment",
          fired: ['() => dispatch("increment")'],
          html: "<div><button>increment</button><button>decrement three times</button><p>one</p></div>",
          hookStates: [1],
        },
        {
          action: "decrement three times",
          fired: ["() => {"],
          html: "<div><button>increment</button><button>decrement three times</button><p>minus two</p></div>",
          hookStates: [-2],
        },
      ],
    },
  },
  {
    source: "useReducer > lazy init",
    file: "update-queues",
    script: {
      component: "ReducerLazyInit",
      html: "<div><button>increment</button><p>ten</p></div>",
      hookStates: [10],
      steps: [
        {
          action: "increment",
          fired: ["onClick"],
          html: "<div><button>increment</button><p>eleven</p></div>",
          hookStates: [11],
        },
      ],
    },
  },
  {
    source: "state bail out edge case (#16359)",
    file: "update-queues",
    script: {
      component: "SameValueBailsOut",
      html: "<div><button>bail out</button><p>count zero</p><p>other zero</p></div>",
      hookStates: [0, 0],
      steps: [
        {
          action: "bail out",
          fired: ["onClick"],
          html: "<div><button>bail out</button><p>count zero</p><p>other one</p></div>",
          hookStates: [0, 1],
        },
      ],
    },
  },
  {
    source:
      "after useLayoutEffect > force flushes passive effects before firing new layout effects",
    file: "effect-ordering",
    script: {
      component: "LayoutBeforePassive",
      html: "<p>layout then passive</p>",
      hookStates: ["layout then passive"],
      steps: [],
    },
  },
  {
    source: "after useEffect > unmounts previous effect",
    file: "effect-ordering",
    script: {
      component: "UnmountsPreviousEffect",
      html: "<div><button>increment</button><p>zero</p><p>created</p></div>",
      hookStates: [0, "created"],
      steps: [
        {
          action: "increment",
          fired: ["onClick"],
          html: "<div><button>increment</button><p>one</p><p>created</p></div>",
          hookStates: [1, "created"],
        },
      ],
    },
  },
  {
    source: "after useEffect > unmounts all previous effects before creating any new ones",
    file: "effect-ordering",
    gap: "every cleanup runs before any effect body, and the analyzer interleaves them",
    script: {
      component: "UnmountsAllBeforeCreatingAny",
      html: "<div><button>increment</button><p>zero</p><p>AB</p></div>",
      hookStates: [0, "AB"],
      steps: [
        {
          action: "increment",
          fired: ["onClick"],
          html: "<div><button>increment</button><p>one</p><p>AB-abAB</p></div>",
          hookStates: [1, "AB-abAB"],
        },
      ],
    },
  },
  {
    source: "after useEffect > multiple effects",
    file: "effect-ordering",
    script: {
      component: "MultipleEffectsInOrder",
      html: "<p>12</p>",
      hookStates: ["12"],
      steps: [],
    },
  },
  {
    source: "after useEffect > skips effect if inputs have not changed",
    file: "effect-ordering",
    script: {
      component: "SkipsEffectWhenDepsAreSame",
      html: "<div><button>other</button><button>label</button><p>label a</p><p>other zero</p><p>runs one</p></div>",
      hookStates: ["a", 0, 1],
      steps: [
        {
          action: "other",
          fired: ["() => setOther"],
          html: "<div><button>other</button><button>label</button><p>label a</p><p>other one</p><p>runs one</p></div>",
          hookStates: ["a", 1, 1],
        },
        {
          action: "label",
          fired: ["() => setLabel"],
          html: "<div><button>other</button><button>label</button><p>label b</p><p>other one</p><p>runs two</p></div>",
          hookStates: ["b", 1, 2],
        },
      ],
    },
  },
  {
    source: "after useEffect > always fires effects if no dependencies are provided",
    file: "effect-ordering",
    script: {
      component: "EffectWithoutDepsRunsEveryCommit",
      html: "<div><button>set</button><p>value zero</p><p>synced zero</p></div>",
      hookStates: [0, 0],
      steps: [
        {
          action: "set",
          fired: ["onClick"],
          html: "<div><button>set</button><p>value one</p><p>synced one</p></div>",
          hookStates: [1, 1],
        },
      ],
    },
  },
  {
    source: "after useReducer does not eagerly bail out of state updates",
    file: "effect-ordering",
    script: {
      component: "EffectReadsLatestDeps",
      html: "<div><button>two</button><p>count one</p><p>state one</p></div>",
      hookStates: [1, 1],
      steps: [
        {
          action: "two",
          fired: ["onClick"],
          html: "<div><button>two</button><p>count two</p><p>state two</p></div>",
          hookStates: [2, 2],
        },
      ],
    },
  },
  {
    source:
      "updates during the render phase > keeps restarting until there are no more new updates",
    file: "render-phase-updates",
    script: {
      component: "RestartsUntilStable",
      html: "<p>three</p>",
      hookStates: [3],
      steps: [],
    },
  },
  {
    source: "updates during the render phase > updates multiple times within same render function",
    file: "render-phase-updates",
    script: {
      component: "UpdatesManyTimesInOneRender",
      html: "<p>twelve</p>",
      hookStates: [12],
      steps: [],
    },
  },
  {
    source: "updates during the render phase > works with useReducer",
    file: "render-phase-updates",
    script: {
      component: "RenderPhaseReducer",
      html: "<p>three</p>",
      hookStates: [3],
      steps: [],
    },
  },
  {
    source:
      "after updates during the render phase > restarts the render function and applies the new updates on top",
    file: "render-phase-updates",
    script: {
      component: "RestartsWithNewUpdatesOnTop",
      html: "<div><button>five</button><button>two</button><p>up</p></div>",
      hookStates: [1, 1, false],
      steps: [
        {
          action: "five",
          fired: ["() => setRow(5)"],
          html: "<div><button>five</button><button>two</button><p>down</p></div>",
          hookStates: [5, 5, true],
        },
        {
          action: "two",
          fired: ["() => setRow(2)"],
          html: "<div><button>five</button><button>two</button><p>up</p></div>",
          hookStates: [2, 2, false],
        },
      ],
    },
  },
  {
    source: "should process the rest pending updates after a render phase update",
    file: "render-phase-updates",
    script: {
      component: "ProcessesRestAfterRenderPhaseUpdate",
      html: "<div><button>update</button><p>a</p><p>b</p><p>c</p></div>",
      hookStates: [false, false, false],
      steps: [
        {
          action: "update",
          fired: ["onClick"],
          html: "<div><button>update</button><p>A</p><p>B</p><p>C</p></div>",
          hookStates: [true, true, true],
        },
      ],
    },
  },
]);

describePorts("useRef-test.internal.js > useRef", [
  {
    source: "after creates a ref object initialized with the provided value",
    file: "refs",
    script: {
      component: "RefInitialValueInRender",
      html: "<p>ready</p>",
      hookStates: [],
      steps: [],
    },
  },
  {
    source:
      "after should not warn about reads or writes outside of render phase (e.g. event handler)",
    file: "refs",
    gap: "a ref a handler writes is read in render as its initial value",
    script: {
      component: "RefWrittenInHandlerReadAfterUpdate",
      html: "<div><button>click</button><p>zero</p></div>",
      hookStates: [false],
      steps: [
        {
          action: "click",
          fired: ["onClick"],
          html: "<div><button>click</button><p>one</p></div>",
          hookStates: [true],
        },
        {
          action: "click",
          fired: ["onClick"],
          html: "<div><button>click</button><p>more</p></div>",
          hookStates: [false],
        },
      ],
    },
  },
]);

describePorts("analyzer cases beyond React's tests", [
  {
    source: "a submit button's own click handler and the form's submit run in one click",
    file: "event-propagation",
    script: {
      component: "SubmitButtonClickAndSubmit",
      html: "<form><button>send</button><p>untouched</p><p>draft</p></form>",
      hookStates: [false, false],
      steps: [
        {
          action: "send",
          fired: ["onClick", "onSubmit"],
          html: "<form><button>send</button><p>clicked</p><p>sent</p></form>",
          hookStates: [true, true],
        },
      ],
    },
  },
  {
    source: "a type=button button inside a form doesn't submit it",
    file: "event-propagation",
    script: {
      component: "ButtonTypeButtonDoesNotSubmit",
      html: "<form><button>press</button><p>untouched</p><p>draft</p></form>",
      hookStates: [false, false],
      steps: [
        {
          action: "press",
          fired: ["onClick"],
          html: "<form><button>press</button><p>clicked</p><p>draft</p></form>",
          hookStates: [true, false],
        },
      ],
    },
  },
  {
    source: "writing a ref without a state update doesn't render",
    file: "refs",
    script: {
      component: "RefWriteWithoutUpdateDoesNotRender",
      html: "<div><button>click</button><p>zero</p></div>",
      hookStates: [],
      steps: [
        {
          action: "click",
          fired: ["onClick"],
          html: "<div><button>click</button><p>zero</p></div>",
          hookStates: [],
        },
      ],
    },
  },
]);
