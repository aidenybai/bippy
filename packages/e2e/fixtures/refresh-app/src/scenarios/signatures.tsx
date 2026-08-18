// Ported from facebook/react packages/react-refresh/src/__tests__/ReactFresh-test.js
// (MIT licensed, Copyright (c) Meta Platforms, Inc. and affiliates), adapted to run
// in a real browser against real react-dom with bippy instrumentation active.
import type * as React from "react";

import type { HarnessTools, Scenario } from "../harness";

interface SyncFunctionComponent {
  (props: object): React.ReactElement;
}

interface WrapHello {
  (
    tools: HarnessTools,
    Hello: SyncFunctionComponent,
  ): React.ComponentType<object> | React.LazyExoticComponent<React.ComponentType<object>>;
}

const defineHello = (tools: HarnessTools, color: string, signature?: string) => {
  const { React: ReactModule } = tools;
  const Hello = () => {
    const [value, setValue] = ReactModule.useState(0);
    return (
      <p style={{ color }} onClick={() => setValue(value + 1)}>
        {value}
      </p>
    );
  };
  tools.register(Hello, "Hello");
  if (signature !== undefined) {
    tools.setSignature(Hello, signature);
  }
  return Hello;
};

// Port of testRemountingWithWrapper: a signature-preserving patch keeps
// state, a signature change (or signature removal) forces a remount, all
// through an arbitrary wrapper between the root and the component.
const runRemountingWithWrapper = async (tools: HarnessTools, wrap: WrapHello): Promise<void> => {
  const { render, patch, expect, firstElement, clickElement, container } = tools;

  await render(() => wrap(tools, defineHello(tools, "blue", "1")));

  const element = firstElement();
  expect(element.textContent).toBe("0");
  expect(element.style.color).toBe("blue");
  await clickElement(element);
  expect(element.textContent).toBe("1");

  // Same signature: hot update without remounting.
  await patch(() => defineHello(tools, "red", "1"));
  expect(container.firstChild).toBe(element);
  expect(element.textContent).toBe("1");
  expect(element.style.color).toBe("red");

  // Changed signature: remount.
  await patch(() => defineHello(tools, "yellow", "2"));
  expect(container.firstChild).not.toBe(element);
  const remountedElement = firstElement();
  expect(remountedElement.textContent).toBe("0");
  expect(remountedElement.style.color).toBe("yellow");

  await clickElement(remountedElement);
  expect(remountedElement.textContent).toBe("1");
  expect(remountedElement.style.color).toBe("yellow");

  // Same signature again: state stays.
  await patch(() => defineHello(tools, "purple", "2"));
  expect(container.firstChild).toBe(remountedElement);
  expect(remountedElement.textContent).toBe("1");
  expect(remountedElement.style.color).toBe("purple");

  // Removing the signature also remounts.
  await patch(() => defineHello(tools, "orange"));
  expect(container.firstChild).not.toBe(remountedElement);
  const finalElement = firstElement();
  expect(finalElement.textContent).toBe("0");
  expect(finalElement.style.color).toBe("orange");
};

interface StressHelloProps {
  children?: React.ReactNode;
}

const defineStressHello = (tools: HarnessTools, color: string, signature: string) => {
  const Hello = ({ children }: StressHelloProps) => (
    <section data-color={color}>{children}</section>
  );
  tools.register(Hello, "Hello");
  tools.setSignature(Hello, signature);
  return Hello;
};

export const signatureScenarios: Record<string, Scenario> = {
  "can force remount by changing signature": async (tools) => {
    const { render, patch, expect, firstElement, clickElement, container } = tools;

    const HelloV1 = await render(() => defineHello(tools, "blue", "1"));

    const element = firstElement();
    expect(element.textContent).toBe("0");
    expect(element.style.color).toBe("blue");
    await clickElement(element);
    expect(element.textContent).toBe("1");

    const HelloV2 = await patch(() => defineHello(tools, "red", "1"));

    expect(container.firstChild).toBe(element);
    expect(element.textContent).toBe("1");
    expect(element.style.color).toBe("red");

    const HelloV3 = await patch(() => defineHello(tools, "yellow", "2"));

    expect(container.firstChild).not.toBe(element);
    const remountedElement = firstElement();
    expect(remountedElement.textContent).toBe("0");
    expect(remountedElement.style.color).toBe("yellow");

    await clickElement(remountedElement);
    expect(remountedElement.textContent).toBe("1");
    expect(remountedElement.style.color).toBe("yellow");

    // Stale and fresh types must all resolve to the latest version.
    await tools.render(() => HelloV1);
    await tools.render(() => HelloV2);
    await tools.render(() => HelloV3);
    await tools.render(() => HelloV2);
    await tools.render(() => HelloV1);
    expect(container.firstChild).toBe(remountedElement);
    expect(remountedElement.textContent).toBe("1");
    expect(remountedElement.style.color).toBe("yellow");

    await patch(() => defineHello(tools, "purple", "2"));
    expect(container.firstChild).toBe(remountedElement);
    expect(remountedElement.textContent).toBe("1");
    expect(remountedElement.style.color).toBe("purple");

    await patch(() => defineHello(tools, "orange"));
    expect(container.firstChild).not.toBe(remountedElement);
    const finalElement = firstElement();
    expect(finalElement.textContent).toBe("0");
    expect(finalElement.style.color).toBe("orange");
  },

  "keeps a valid tree when forcing remount": async (tools) => {
    const { React: ReactModule, patch, renderElement, expect, container } = tools;

    const HelloV1 = defineStressHello(tools, "blue", "1");
    const Bailout = ReactModule.memo(({ children }: { children?: React.ReactNode }) => children);

    // Each tree renders exactly three Hello instances in structurally
    // tricky arrangements (bailouts, keys, nested arrays, text siblings).
    const trees: React.ReactElement[] = [
      <div>
        <HelloV1 />
        <div>
          <HelloV1 />
          <Bailout>
            <HelloV1 />
          </Bailout>
        </div>
      </div>,
      <div>
        <div>
          <HelloV1>
            <HelloV1 />
          </HelloV1>
          <HelloV1 />
        </div>
      </div>,
      <div>
        <span />
        <HelloV1 />
        <HelloV1 />
        <HelloV1 />
      </div>,
      <div>
        <HelloV1 />
        <span />
        <HelloV1 />
        <HelloV1 />
      </div>,
      <div>
        <div>foo</div>
        <HelloV1 />
        <div>
          <HelloV1 />
        </div>
        <HelloV1 />
        <span />
      </div>,
      <div>
        <HelloV1>
          <span />
          Hello
          <span />
        </HelloV1>
        ,
        <HelloV1>
          <>
            <HelloV1 />
          </>
        </HelloV1>
        ,
      </div>,
      <HelloV1>
        <HelloV1>
          <Bailout>
            <span />
            <HelloV1>
              <span />
            </HelloV1>
            <span />
          </Bailout>
        </HelloV1>
      </HelloV1>,
      <div>
        <span />
        <HelloV1 key="0" />
        <HelloV1 key="1" />
        <HelloV1 key="2" />
        <span />
      </div>,
      <div>
        <span />
        {null}
        <HelloV1 key="1" />
        {null}
        <HelloV1 />
        <HelloV1 />
        <span />
      </div>,
      <div>
        <HelloV1 key="2" />
        <span />
        <HelloV1 key="0" />
        <span />
        <HelloV1 key="1" />
      </div>,
      <div>
        {[[<HelloV1 key="2" />]]}
        <span>
          <HelloV1 key="0" />
          {[null]}
          <HelloV1 key="1" />
        </span>
      </div>,
      <div>
        {["foo", <HelloV1 key="hi" />, null, <HelloV1 key="2" />]}
        <span>
          {[null]}
          <HelloV1 key="x" />
        </span>
      </div>,
      <HelloV1>
        <HelloV1>
          <span />
          <Bailout>
            <HelloV1>hi</HelloV1>
            <span />
          </Bailout>
        </HelloV1>
      </HelloV1>,
    ];

    const runRemountingStressTest = async (tree: React.ReactElement): Promise<void> => {
      await patch(() => defineStressHello(tools, "blue", "1"));
      await renderElement(tree);

      const sections = Array.from(container.querySelectorAll("section"));
      expect(sections.length).toBe(3);
      for (const section of sections) {
        expect(section.dataset.color).toBe("blue");
      }

      // Patch color without changing the signature: same DOM nodes.
      await patch(() => defineStressHello(tools, "red", "1"));
      const sectionsAfterPatch = Array.from(container.querySelectorAll("section"));
      expect(sectionsAfterPatch.length).toBe(3);
      sectionsAfterPatch.forEach((section, sectionIndex) => {
        expect(section).toBe(sections[sectionIndex]);
        expect(section.dataset.color).toBe("red");
      });

      // Patch color and change the signature: fresh DOM nodes.
      await patch(() => defineStressHello(tools, "orange", "2"));
      const sectionsAfterRemount = Array.from(container.querySelectorAll("section"));
      expect(sectionsAfterRemount.length).toBe(3);
      sectionsAfterRemount.forEach((section, sectionIndex) => {
        expect(section).not.toBe(sections[sectionIndex]);
        expect(section.dataset.color).toBe("orange");
      });

      // Patch color with the same signature: nodes stay.
      await patch(() => defineStressHello(tools, "black", "2"));
      const sectionsAfterSecondPatch = Array.from(container.querySelectorAll("section"));
      expect(sectionsAfterSecondPatch.length).toBe(3);
      sectionsAfterSecondPatch.forEach((section, sectionIndex) => {
        expect(section).toBe(sectionsAfterRemount[sectionIndex]);
        expect(section.dataset.color).toBe("black");
      });

      await renderElement(tree);
      const sectionsAfterRerender = Array.from(container.querySelectorAll("section"));
      expect(sectionsAfterRerender.length).toBe(3);
      sectionsAfterRerender.forEach((section, sectionIndex) => {
        expect(section).toBe(sectionsAfterRemount[sectionIndex]);
        expect(section.dataset.color).toBe("black");
      });
    };

    await renderElement(null);
    for (const tree of trees) {
      await runRemountingStressTest(tree);
    }

    // Each tree must also be resilient to updates coming from another tree.
    // Intentionally no cleanup between the runs inside each pairing.
    for (const firstTree of trees) {
      for (const secondTree of trees) {
        await renderElement(null);
        await runRemountingStressTest(firstTree);
        await runRemountingStressTest(secondTree);
        await runRemountingStressTest(firstTree);
      }
    }
  },

  "remounts on signature change within a root wrapper": async (tools) => {
    await runRemountingWithWrapper(tools, (_innerTools, Hello) => Hello);
  },

  "remounts on signature change within a simple memo wrapper": async (tools) => {
    await runRemountingWithWrapper(tools, ({ React: ReactModule }, Hello) =>
      ReactModule.memo(Hello),
    );
  },

  "remounts on signature change within a lazy simple memo wrapper": async (tools) => {
    await runRemountingWithWrapper(tools, ({ React: ReactModule }, Hello) =>
      ReactModule.lazy(() => Promise.resolve({ default: ReactModule.memo(Hello) })),
    );
  },

  "remounts on signature change within forwardRef": async (tools) => {
    await runRemountingWithWrapper(tools, ({ React: ReactModule }, Hello) =>
      ReactModule.forwardRef(Hello),
    );
  },

  "remounts on signature change within forwardRef render function": async (tools) => {
    await runRemountingWithWrapper(tools, ({ React: ReactModule }, Hello) =>
      ReactModule.forwardRef(() => <Hello />),
    );
  },

  "remounts on signature change within nested memo": async (tools) => {
    await runRemountingWithWrapper(tools, ({ React: ReactModule }, Hello) =>
      ReactModule.memo(ReactModule.memo(ReactModule.memo(Hello))),
    );
  },

  "remounts on signature change within a memo wrapper and custom comparison": async (tools) => {
    await runRemountingWithWrapper(tools, ({ React: ReactModule }, Hello) =>
      ReactModule.memo(Hello, () => true),
    );
  },

  "remounts on signature change within a class": async (tools) => {
    await runRemountingWithWrapper(tools, ({ React: ReactModule }, Hello) => {
      const child = <Hello />;
      return class Wrapper extends ReactModule.PureComponent {
        override render() {
          return child;
        }
      };
    });
  },

  "remounts on signature change within a context provider": async (tools) => {
    await runRemountingWithWrapper(tools, ({ React: ReactModule }, Hello) => {
      const WrapperContext = ReactModule.createContext<string | undefined>(undefined);
      const child = (
        <WrapperContext.Provider value="constant">
          <Hello />
        </WrapperContext.Provider>
      );
      return () => child;
    });
  },

  "remounts on signature change within a context consumer": async (tools) => {
    await runRemountingWithWrapper(tools, ({ React: ReactModule }, Hello) => {
      const WrapperContext = ReactModule.createContext<string | undefined>(undefined);
      const child = <WrapperContext.Consumer>{() => <Hello />}</WrapperContext.Consumer>;
      return () => child;
    });
  },

  "remounts on signature change within a suspense node": async (tools) => {
    await runRemountingWithWrapper(tools, ({ React: ReactModule }, Hello) => {
      const child = (
        <ReactModule.Suspense>
          <Hello />
        </ReactModule.Suspense>
      );
      return () => child;
    });
  },

  "remounts on signature change within a mode node": async (tools) => {
    await runRemountingWithWrapper(tools, ({ React: ReactModule }, Hello) => {
      const child = (
        <ReactModule.StrictMode>
          <Hello />
        </ReactModule.StrictMode>
      );
      return () => child;
    });
  },

  "remounts on signature change within a fragment node": async (tools) => {
    await runRemountingWithWrapper(tools, (_innerTools, Hello) => {
      const child = (
        <>
          <Hello />
        </>
      );
      return () => child;
    });
  },

  "remounts on signature change within multiple siblings": async (tools) => {
    await runRemountingWithWrapper(tools, ({ React: ReactModule }, Hello) => {
      const child = (
        <>
          <>
            <ReactModule.Fragment />
          </>
          <Hello />
          <ReactModule.Fragment />
        </>
      );
      return () => child;
    });
  },

  "remounts on signature change within a profiler node": async (tools) => {
    await runRemountingWithWrapper(tools, ({ React: ReactModule }, Hello) => {
      const child = <Hello />;
      return () => (
        <ReactModule.Profiler onRender={() => {}} id="foo">
          {child}
        </ReactModule.Profiler>
      );
    });
  },
};
