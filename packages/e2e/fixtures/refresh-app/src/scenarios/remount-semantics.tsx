// Ported from facebook/react packages/react-refresh/src/__tests__/ReactFresh-test.js
// (MIT licensed, Copyright (c) Meta Platforms, Inc. and affiliates), adapted to run
// in a real browser against real react-dom with bippy instrumentation active.
import type * as React from "react";

import type { Scenario } from "../harness";

export const remountSemanticsScenarios: Record<string, Scenario> = {
  "remounts when function changes to memo": async (tools) => {
    const { React: ReactModule, render, patch, expect, firstElement, container } = tools;

    await render(() => {
      const Test = () => <p>hi test</p>;
      tools.register(Test, "Test");
      return Test;
    });

    const element = firstElement();
    expect(element.textContent).toBe("hi test");

    await patch(() => {
      const Test2 = () => <p>hi memo</p>;
      const Test = ReactModule.memo(Test2);
      tools.register(Test2, "Test2");
      tools.register(Test, "Test");
      return Test;
    });

    expect(container.firstChild).not.toBe(element);
    const memoElement = firstElement();
    expect(memoElement.textContent).toBe("hi memo");

    await patch(() => {
      const Test = () => <p>hi test</p>;
      tools.register(Test, "Test");
      return Test;
    });

    expect(container.firstChild).not.toBe(memoElement);
    expect(firstElement().textContent).toBe("hi test");
  },

  "remounts when memo changes to forwardRef": async (tools) => {
    const { React: ReactModule, render, patch, expect, firstElement, container } = tools;

    await render(() => {
      const Test2 = () => <p>hi memo</p>;
      const Test = ReactModule.memo(Test2);
      tools.register(Test2, "Test2");
      tools.register(Test, "Test");
      return Test;
    });

    const element = firstElement();
    expect(element.textContent).toBe("hi memo");

    await patch(() => {
      const Test = ReactModule.forwardRef(() => <p>hi forwardRef</p>);
      tools.register(Test, "Test");
      return Test;
    });

    expect(container.firstChild).not.toBe(element);
    const forwardRefElement = firstElement();
    expect(forwardRefElement.textContent).toBe("hi forwardRef");

    await patch(() => {
      const Test2 = () => <p>hi memo</p>;
      const Test = ReactModule.memo(Test2);
      tools.register(Test2, "Test2");
      tools.register(Test, "Test");
      return Test;
    });

    expect(container.firstChild).not.toBe(forwardRefElement);
    expect(firstElement().textContent).toBe("hi memo");
  },

  "remounts when function changes to forwardRef": async (tools) => {
    const { React: ReactModule, render, patch, expect, firstElement, container } = tools;

    await render(() => {
      const Test = () => <p>hi test</p>;
      tools.register(Test, "Test");
      return Test;
    });

    const element = firstElement();
    expect(element.textContent).toBe("hi test");

    await patch(() => {
      const Test = ReactModule.forwardRef(() => <p>hi forwardRef</p>);
      tools.register(Test, "Test");
      return Test;
    });

    expect(container.firstChild).not.toBe(element);
    const forwardRefElement = firstElement();
    expect(forwardRefElement.textContent).toBe("hi forwardRef");

    await patch(() => {
      const Test = () => <p>hi test1</p>;
      tools.register(Test, "Test");
      return Test;
    });

    expect(container.firstChild).not.toBe(forwardRefElement);
    expect(firstElement().textContent).toBe("hi test1");
  },

  "remounts when memo inner type changes from function to forwardRef": async (tools) => {
    const { React: ReactModule, render, patch, expect, firstElement, container } = tools;

    await render(() => {
      const Test2 = () => <p>hi memo</p>;
      const Test = ReactModule.memo(Test2);
      tools.register(Test2, "Test$React.memo");
      tools.register(Test, "Test");
      return Test;
    });

    const element = firstElement();
    expect(element.textContent).toBe("hi memo");

    // The outer type stays memo; only the inner family changes kind.
    await patch(() => {
      const Test2 = ReactModule.forwardRef(() => <p>hi memo forwardRef</p>);
      const Test = ReactModule.memo(Test2);
      tools.register(Test2, "Test$React.memo");
      tools.register(Test, "Test");
      return Test;
    });

    expect(container.firstChild).not.toBe(element);
    const forwardRefElement = firstElement();
    expect(forwardRefElement.textContent).toBe("hi memo forwardRef");

    await patch(() => {
      const Test2 = () => <p>hi memo</p>;
      const Test = ReactModule.memo(Test2);
      tools.register(Test2, "Test$React.memo");
      tools.register(Test, "Test");
      return Test;
    });

    expect(container.firstChild).not.toBe(forwardRefElement);
    expect(firstElement().textContent).toBe("hi memo");
  },

  "mounts an element created before its type changed kinds": async (tools) => {
    const { React: ReactModule, render, patch, expect, firstElement, clickElement } = tools;

    let preEditElement: React.ReactElement | null = null;
    let currentChild: React.ReactElement | null = null;

    const defineApp = () => {
      const App = () => {
        const [, forceUpdate] = ReactModule.useState(0);
        return <div onClick={() => forceUpdate((previous) => previous + 1)}>{currentChild}</div>;
      };
      tools.register(App, "App");
      return App;
    };

    await render(() => {
      const Test = () => <p>hi test</p>;
      tools.register(Test, "Test");
      preEditElement = <Test />;
      return defineApp();
    });

    // Change the component kind before the element has ever mounted.
    await patch(() => {
      const Test2 = () => <p>hi memo</p>;
      const Test = ReactModule.memo(Test2);
      tools.register(Test2, "Test$React.memo");
      tools.register(Test, "Test");
      return defineApp();
    });

    // Mounting the pre-edit element must create the fiber from the latest
    // type, with the tag matching its new kind.
    currentChild = preEditElement;
    await clickElement(firstElement());
    expect(firstElement().textContent).toBe("hi memo");
  },

  "remounts when adding or removing a memo comparison function": async (tools) => {
    const { React: ReactModule, render, patch, expect, firstElement, container } = tools;

    await render(() => {
      const Test2 = () => <p>hi memo</p>;
      const Test = ReactModule.memo(Test2);
      tools.register(Test2, "Test$React.memo");
      tools.register(Test, "Test");
      return Test;
    });

    const element = firstElement();
    expect(element.textContent).toBe("hi memo");

    // Adding a comparison function means the fiber can no longer be a
    // SimpleMemoComponent, forcing a remount.
    await patch(() => {
      const Test2 = () => <p>hi memo with compare</p>;
      const Test = ReactModule.memo(Test2, () => false);
      tools.register(Test2, "Test$React.memo");
      tools.register(Test, "Test");
      return Test;
    });

    expect(container.firstChild).not.toBe(element);
    const comparedElement = firstElement();
    expect(comparedElement.textContent).toBe("hi memo with compare");

    await patch(() => {
      const Test2 = () => <p>hi memo</p>;
      const Test = ReactModule.memo(Test2);
      tools.register(Test2, "Test$React.memo");
      tools.register(Test, "Test");
      return Test;
    });

    expect(container.firstChild).not.toBe(comparedElement);
    expect(firstElement().textContent).toBe("hi memo");
  },

  "updates a memo comparison function in place": async (tools) => {
    const {
      React: ReactModule,
      render,
      patch,
      expect,
      firstElement,
      clickElement,
      container,
    } = tools;

    interface InnerProps {
      label: string;
    }

    const defineApp = (compare: (prev: InnerProps, next: InnerProps) => boolean) => {
      const Inner = ({ label }: InnerProps) => <p>{label}</p>;
      const InnerMemo = ReactModule.memo(Inner, compare);
      tools.register(Inner, "Inner$React.memo");
      tools.register(InnerMemo, "Inner");

      const App = () => {
        const [count, setCount] = ReactModule.useState(1);
        return (
          <div onClick={() => setCount((previous) => previous + 1)}>
            <InnerMemo label={`n:${count}`} />
          </div>
        );
      };
      tools.register(App, "App");
      return App;
    };

    await render(() => defineApp(() => true));

    const element = firstElement();
    expect(element.textContent).toBe("n:1");

    // The comparison function blocks the update.
    await clickElement(element);
    expect(element.textContent).toBe("n:1");

    // Patch to change only the comparison function implementation.
    await patch(() => defineApp(() => false));

    // No remount, and the previously blocked update shows through because
    // the new comparison function is used.
    expect(container.firstChild).toBe(element);
    expect(element.textContent).toBe("n:2");

    await clickElement(element);
    expect(element.textContent).toBe("n:3");
  },

  "mounts a pre-edit memo element with the latest comparison function": async (tools) => {
    const { React: ReactModule, render, patch, expect, firstElement, clickElement } = tools;

    interface InnerProps {
      label: string;
    }

    let preEditElement: React.ReactElement | null = null;
    let postEditElement: React.ReactElement | null = null;
    let currentChild: React.ReactElement | null = null;

    const defineApp = () => {
      const App = () => {
        const [, forceUpdate] = ReactModule.useState(0);
        return <div onClick={() => forceUpdate((previous) => previous + 1)}>{currentChild}</div>;
      };
      tools.register(App, "App");
      return App;
    };

    await render(() => {
      const Inner = ({ label }: InnerProps) => <p>{label}</p>;
      const InnerMemo = ReactModule.memo(Inner);
      tools.register(Inner, "Inner$React.memo");
      tools.register(InnerMemo, "Inner");
      preEditElement = <InnerMemo label="v1" />;
      return defineApp();
    });

    // Add an update-blocking comparison function before the memo mounted.
    await patch(() => {
      const Inner = ({ label }: InnerProps) => <p>{label}</p>;
      const InnerMemo = ReactModule.memo(Inner, () => true);
      tools.register(Inner, "Inner$React.memo");
      tools.register(InnerMemo, "Inner");
      postEditElement = <InnerMemo label="v2" />;
      return defineApp();
    });

    // The pre-edit element must mount through the latest type.
    currentChild = preEditElement;
    await clickElement(firstElement());
    const innerElement = firstElement().firstChild;
    if (!(innerElement instanceof HTMLElement)) {
      throw new Error("expected inner element to mount");
    }
    expect(innerElement.textContent).toBe("v1");

    // The post-edit element is the same family, so the fiber is reused...
    currentChild = postEditElement;
    await clickElement(firstElement());
    expect(firstElement().firstChild).toBe(innerElement);
    // ...and the blocking comparison function proves the fiber mounted
    // with the latest comparison behavior in effect.
    expect(innerElement.textContent).toBe("v1");
  },

  "remounts an unregistered memo wrapper without losing the wrapper": async (tools) => {
    const {
      React: ReactModule,
      render,
      patch,
      expect,
      firstElement,
      clickElement,
      container,
    } = tools;

    interface InnerProps {
      label: string;
    }

    let innerRenderCount = 0;

    await render(() => {
      const Inner = ({ label }: InnerProps) => {
        innerRenderCount++;
        return <p>{label}</p>;
      };
      tools.register(Inner, "Inner");
      tools.setSignature(Inner, "sig1");
      // The wrapper is deliberately unregistered, like a wrapper created
      // inside a third-party HOC.
      const InnerMemo = ReactModule.memo(Inner);

      const App = () => {
        const [, forceUpdate] = ReactModule.useState(0);
        return (
          <div onClick={() => forceUpdate((previous) => previous + 1)}>
            <InnerMemo label="hi" />
          </div>
        );
      };
      tools.register(App, "App");
      return App;
    });

    expect(container.textContent).toBe("hi");
    expect(innerRenderCount).toBe(1);

    // The memo blocks re-renders with equal props.
    await clickElement(firstElement());
    expect(innerRenderCount).toBe(1);

    // Force a remount by changing the inner function's signature; only the
    // inner module re-runs, so the wrapper is not re-created.
    await patch(() => {
      const Inner = ({ label }: InnerProps) => {
        innerRenderCount++;
        return <p>{label}</p>;
      };
      tools.register(Inner, "Inner");
      tools.setSignature(Inner, "sig2");
      return Inner;
    });
    expect(innerRenderCount).toBe(2);
    const innerElement = firstElement().firstChild;

    // The remounted fiber must still behave as a memo: equal props stay
    // blocked and the fiber reconciles against the original element.
    await clickElement(firstElement());
    expect(innerRenderCount).toBe(2);
    expect(firstElement().firstChild).toBe(innerElement);
  },
};
