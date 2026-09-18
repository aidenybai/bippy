import { expect, it } from "vite-plus/test";
import { installPreactRecorder } from "../src/harness/preact-recorder.js";

interface TestPreactOptions {
  _commit?: (...args: unknown[]) => void;
}

const getAttachedDevTools = (target: object): object => {
  const devTools = Reflect.get(target, "__PREACT_DEVTOOLS__");
  if (typeof devTools !== "object" || devTools === null) {
    throw new Error("Preact DevTools hook was not installed");
  }
  return devTools;
};

it("records Preact commits as React-compatible snapshots", () => {
  const target = {};
  const recorder = installPreactRecorder(target);
  const options: TestPreactOptions = {};
  const Fragment = (props: object): object => props;
  const App = (): null => null;
  const attachPreact = Reflect.get(getAttachedDevTools(target), "attachPreact");
  if (typeof attachPreact !== "function") throw new Error("Preact attach hook is missing");
  Reflect.apply(attachPreact, null, ["10.23.2", options, { Fragment }]);

  const container = { nodeName: "DIV" };
  const hostNode = { parentNode: container };
  const text = { type: null, props: "hello", key: null, _children: [] };
  const host = {
    type: "main",
    props: { id: "content", children: "hello" },
    key: null,
    _dom: hostNode,
    _children: [text],
  };
  const app = { type: App, props: {}, key: null, _children: [host] };
  const root = {
    type: Fragment,
    props: { children: [app] },
    key: null,
    _dom: hostNode,
    _children: [app],
  };
  options._commit?.(root, []);

  expect(recorder.commitCount()).toBe(1);
  expect(recorder.snapshot()).toMatchObject({
    reactVersion: "10.23.2",
    rendererName: "preact",
    buildType: "development",
    roots: [
      {
        tag: "HostRoot",
        name: "HostRoot",
        props: { container: "div" },
        children: [
          {
            tag: "FunctionComponent",
            name: "App",
            children: [
              {
                tag: "HostComponent",
                name: "main",
                props: { id: "content", children: "hello" },
                children: [],
              },
            ],
          },
        ],
      },
    ],
  });
});
