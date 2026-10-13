// Ported from facebook/react packages/react-refresh/src/__tests__/ReactFresh-test.js
// (MIT licensed, Copyright (c) Meta Platforms, Inc. and affiliates), adapted to run
// in a real browser against real react-dom with bippy instrumentation active.
// The failed-root tests use roots with an onUncaughtError capture instead of
// relying on jest act() rethrow semantics.
import type * as React from "react";

import type { HarnessTools, Scenario } from "../harness";

interface BoundaryProps {
  children?: React.ReactNode;
}

// Analog of jest's rejects.toThrow: uncaught root errors propagate out of
// React.act when the refresh work flushes synchronously.
const getThrownMessage = async (run: () => Promise<unknown>): Promise<string | null> => {
  try {
    await run();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};

interface BoundaryState {
  error: Error | null;
}

interface DefineBoundary {
  (tools: HarnessTools): React.ComponentType<BoundaryProps>;
}

const defineComponentDidCatchBoundary: DefineBoundary = ({ React: ReactModule }) =>
  class Boundary extends ReactModule.Component<BoundaryProps, BoundaryState> {
    override state: BoundaryState = { error: null };
    override componentDidCatch(error: Error) {
      this.setState({ error });
    }
    override render() {
      if (this.state.error) {
        return <h1>Oops: {this.state.error.message}</h1>;
      }
      return this.props.children;
    }
  };

const defineDerivedStateBoundary: DefineBoundary = ({ React: ReactModule }) =>
  class Boundary extends ReactModule.Component<BoundaryProps, BoundaryState> {
    override state: BoundaryState = { error: null };
    static getDerivedStateFromError(error: Error): BoundaryState {
      return { error };
    }
    override render() {
      if (this.state.error) {
        return <h1>Oops: {this.state.error.message}</h1>;
      }
      return this.props.children;
    }
  };

// Shared skeleton: break the child, expect the boundary to catch; fix the
// child, expect the boundary itself to remount (but nothing above it);
// then verify the next patch updates in place.
const runFailedBoundaryRemount = async (
  tools: HarnessTools,
  defineBoundary: DefineBoundary,
): Promise<void> => {
  const { render, patch, expect, container } = tools;

  await render(() => {
    const Hello = () => <h1>Hi</h1>;
    tools.register(Hello, "Hello");

    const Boundary = defineBoundary(tools);

    const App = () => (
      <>
        <p>A</p>
        <Boundary>
          <Hello />
        </Boundary>
        <p>B</p>
      </>
    );
    return App;
  });

  expect(container.innerHTML).toBe("<p>A</p><h1>Hi</h1><p>B</p>");
  const firstParagraph = container.firstChild;
  const secondParagraph = firstParagraph?.nextSibling?.nextSibling ?? null;

  // A hot update that fails.
  await patch(() => {
    const Hello = () => {
      throw new Error("No");
    };
    tools.register(Hello, "Hello");
  });

  expect(container.innerHTML).toBe("<p>A</p><h1>Oops: No</h1><p>B</p>");
  expect(container.firstChild).toBe(firstParagraph);
  expect(container.firstChild?.nextSibling?.nextSibling).toBe(secondParagraph);

  // A hot update that fixes the error remounts the boundary only.
  await patch(() => {
    const Hello = () => <h1>Fixed!</h1>;
    tools.register(Hello, "Hello");
  });

  expect(container.innerHTML).toBe("<p>A</p><h1>Fixed!</h1><p>B</p>");
  expect(container.firstChild).toBe(firstParagraph);
  expect(container.firstChild?.nextSibling?.nextSibling).toBe(secondParagraph);

  // The next hot reload must not remount anything.
  const helloNode = container.firstChild?.nextSibling ?? null;
  await patch(() => {
    const Hello = () => <h1>Nice.</h1>;
    tools.register(Hello, "Hello");
  });
  expect(container.firstChild?.nextSibling).toBe(helloNode);
  expect(helloNode?.textContent).toBe("Nice.");
};

export const errorBoundaryScenarios: Record<string, Scenario> = {
  "remounts failed error boundaries (componentDidCatch)": async (tools) => {
    await runFailedBoundaryRemount(tools, defineComponentDidCatchBoundary);
  },

  "remounts failed error boundaries (getDerivedStateFromError)": async (tools) => {
    await runFailedBoundaryRemount(tools, defineDerivedStateBoundary);
  },

  "remounts error boundaries that failed asynchronously after hot update": async (tools) => {
    const { React: ReactModule, render, patch, act, expect, container } = tools;

    let triggerCrash: () => void = () => {};

    await render(() => {
      const Hello = () => {
        const [text] = ReactModule.useState("");
        ReactModule.useEffect(() => {}, []);
        text.slice();
        return <h1>Hi</h1>;
      };
      tools.register(Hello, "Hello");

      const Boundary = defineDerivedStateBoundary(tools);

      const App = () => (
        <>
          <p>A</p>
          <Boundary>
            <Hello />
          </Boundary>
          <p>B</p>
        </>
      );
      return App;
    });

    expect(container.innerHTML).toBe("<p>A</p><h1>Hi</h1><p>B</p>");
    const firstParagraph = container.firstChild;
    const secondParagraph = firstParagraph?.nextSibling?.nextSibling ?? null;

    // A hot update whose effect schedules a state that crashes the next
    // render (setting a number where a string is expected).
    await patch(() => {
      const Hello = () => {
        const [text, setText] = ReactModule.useState<string>("");
        ReactModule.useEffect(() => {
          triggerCrash = () => {
            setText(42 as unknown as string);
          };
        }, []);
        text.slice();
        return <h1>Hi</h1>;
      };
      tools.register(Hello, "Hello");
    });

    expect(container.innerHTML).toBe("<p>A</p><h1>Hi</h1><p>B</p>");
    await act(() => {
      triggerCrash();
    });
    expect(container.innerHTML).toBe("<p>A</p><h1>Oops: text.slice is not a function</h1><p>B</p>");
    expect(container.firstChild).toBe(firstParagraph);
    expect(container.firstChild?.nextSibling?.nextSibling).toBe(secondParagraph);

    // A hot update that fixes the error remounts the boundary.
    await patch(() => {
      const Hello = () => {
        const [text] = ReactModule.useState("");
        ReactModule.useEffect(() => {}, []);
        text.slice();
        return <h1>Fixed!</h1>;
      };
      tools.register(Hello, "Hello");
    });

    expect(container.innerHTML).toBe("<p>A</p><h1>Fixed!</h1><p>B</p>");
    expect(container.firstChild).toBe(firstParagraph);
    expect(container.firstChild?.nextSibling?.nextSibling).toBe(secondParagraph);

    const helloNode = container.firstChild?.nextSibling ?? null;
    await patch(() => {
      const Hello = () => {
        const [text] = ReactModule.useState("");
        ReactModule.useEffect(() => {}, []);
        text.slice();
        return <h1>Nice.</h1>;
      };
      tools.register(Hello, "Hello");
    });

    expect(container.firstChild?.nextSibling).toBe(helloNode);
    expect(helloNode?.textContent).toBe("Nice.");
  },

  "remounts a failed root on mount": async (tools) => {
    const { act, patch, expect, createExtraRoot } = tools;

    const { container: failedContainer, root: failedRoot } = createExtraRoot();

    const defineThrowingHello = (message: string) => {
      const Hello = () => {
        throw new Error(message);
      };
      tools.register(Hello, "Hello");
      return Hello;
    };

    const HelloV1 = defineThrowingHello("No");
    expect(
      await getThrownMessage(() =>
        act(() => {
          failedRoot.render(<HelloV1 />);
        }),
      ),
    ).toBe("No");
    expect(failedContainer.innerHTML).toBe("");

    // A bad retry.
    expect(await getThrownMessage(() => patch(() => defineThrowingHello("Not yet")))).toBe(
      "Not yet",
    );
    expect(failedContainer.innerHTML).toBe("");

    // A hot update that fixes the error mounts the root.
    await patch(() => {
      const Hello = () => <h1>Fixed!</h1>;
      tools.register(Hello, "Hello");
    });
    expect(failedContainer.innerHTML).toBe("<h1>Fixed!</h1>");

    // Failing and recovering keeps working later.
    expect(await getThrownMessage(() => patch(() => defineThrowingHello("No 2")))).toBe("No 2");
    expect(failedContainer.innerHTML).toBe("");

    expect(await getThrownMessage(() => patch(() => defineThrowingHello("Not yet 2")))).toBe(
      "Not yet 2",
    );
    expect(failedContainer.innerHTML).toBe("");

    await patch(() => {
      const Hello = () => <h1>Fixed 2!</h1>;
      tools.register(Hello, "Hello");
    });
    expect(failedContainer.innerHTML).toBe("<h1>Fixed 2!</h1>");

    // Updates after an intentional unmount are ignored.
    await act(() => {
      failedRoot.unmount();
    });
    await patch(() => defineThrowingHello("Ignored"));
    expect(failedContainer.innerHTML).toBe("");
    await patch(() => {
      const Hello = () => <h1>Ignored</h1>;
      tools.register(Hello, "Hello");
    });
    expect(failedContainer.innerHTML).toBe("");
  },

  "does not retry an intentionally unmounted failed root": async (tools) => {
    const { act, patch, expect, createExtraRoot } = tools;

    const { container: failedContainer, root: failedRoot } = createExtraRoot();

    const Hello = () => {
      throw new Error("No");
    };
    tools.register(Hello, "Hello");
    expect(
      await getThrownMessage(() =>
        act(() => {
          failedRoot.render(<Hello />);
        }),
      ),
    ).toBe("No");
    expect(failedContainer.innerHTML).toBe("");

    // Intentional unmount.
    await act(() => {
      failedRoot.unmount();
    });

    // A hot update that fixes the error must stay unmounted.
    await patch(() => {
      const HelloFixed = () => <h1>Fixed!</h1>;
      tools.register(HelloFixed, "Hello");
    });
    expect(failedContainer.innerHTML).toBe("");
  },

  "remounts a failed root on update": async (tools) => {
    const { act, patch, expect, createExtraRoot } = tools;

    const { container: rootContainer, root } = createExtraRoot();

    const defineHello = (text: string) => {
      const Hello = () => <h1>{text}</h1>;
      tools.register(Hello, "Hello");
      return Hello;
    };
    const defineThrowingHello = (message: string) => {
      const Hello = () => {
        throw new Error(message);
      };
      tools.register(Hello, "Hello");
      return Hello;
    };

    const HelloV1 = defineHello("Hi");
    await act(() => {
      root.render(<HelloV1 />);
    });
    expect(rootContainer.innerHTML).toBe("<h1>Hi</h1>");

    // A hot update that fails removes the root content.
    expect(await getThrownMessage(() => patch(() => defineThrowingHello("No")))).toBe("No");
    expect(rootContainer.innerHTML).toBe("");

    // A bad retry.
    expect(await getThrownMessage(() => patch(() => defineThrowingHello("Not yet")))).toBe(
      "Not yet",
    );
    expect(rootContainer.innerHTML).toBe("");

    // A hot update that fixes the error remounts the root.
    await patch(() => defineHello("Fixed!"));
    expect(rootContainer.innerHTML).toBe("<h1>Fixed!</h1>");

    // The next hot reload must not remount anything.
    const helloNode = rootContainer.firstChild;
    await patch(() => defineHello("Nice."));
    expect(rootContainer.firstChild).toBe(helloNode);
    expect(helloNode?.textContent).toBe("Nice.");

    // Break and fix again.
    expect(await getThrownMessage(() => patch(() => defineThrowingHello("Oops")))).toBe("Oops");
    expect(rootContainer.innerHTML).toBe("");

    await patch(() => defineHello("At last."));
    expect(rootContainer.innerHTML).toBe("<h1>At last.</h1>");

    // An intentional unmount must not be reversed.
    await act(() => {
      root.unmount();
    });
    expect(rootContainer.innerHTML).toBe("");
    await patch(() => defineHello("Never mind me!"));
    expect(rootContainer.innerHTML).toBe("");

    // A fresh root on the same container works, and an intentional unmount
    // is not reversed even after an error.
    const { container: secondContainer, root: secondRoot } = createExtraRoot();
    const HelloAgain = defineHello("Hi");
    await act(() => {
      secondRoot.render(<HelloAgain />);
    });
    expect(secondContainer.innerHTML).toBe("<h1>Hi</h1>");

    expect(await getThrownMessage(() => patch(() => defineThrowingHello("Oops")))).toBe("Oops");
    expect(secondContainer.innerHTML).toBe("");

    await act(() => {
      secondRoot.unmount();
    });
    expect(secondContainer.innerHTML).toBe("");
    await patch(() => defineHello("Never mind me!"));
    expect(secondContainer.innerHTML).toBe("");
  },

  "regression test: does not get into an infinite loop": async (tools) => {
    const { React: ReactModule, ReactFreshRuntime, act, expect, createExtraRoot } = tools;

    const { container: containerA, root: rootA } = createExtraRoot();
    const { container: containerB, root: rootB } = createExtraRoot();

    const RootAV1 = () => "A1";
    tools.register(RootAV1, "RootA");
    const RootBV1 = () => "B1";
    tools.register(RootBV1, "RootB");

    await act(() => {
      rootA.render(<RootAV1 />);
      rootB.render(<RootBV1 />);
    });
    expect(containerA.innerHTML).toBe("A1");
    expect(containerB.innerHTML).toBe("B1");

    // Make the first root fail.
    const RootAV2 = () => {
      throw new Error("A2!");
    };
    tools.register(RootAV2, "RootA");
    expect(
      await getThrownMessage(() =>
        act(() => {
          ReactFreshRuntime.performReactRefresh();
        }),
      ),
    ).toBe("A2!");
    expect(containerA.innerHTML).toBe("");
    expect(containerB.innerHTML).toBe("B1");

    // Patch the first root but fail in the commit phase. This used to
    // trigger an infinite loop because the failed-roots list was mutated
    // while being iterated.
    const RootAV3 = () => {
      ReactModule.useLayoutEffect(() => {
        throw new Error("A3!");
      }, []);
      return "A3";
    };
    tools.register(RootAV3, "RootA");
    expect(
      await getThrownMessage(() =>
        act(() => {
          ReactFreshRuntime.performReactRefresh();
        }),
      ),
    ).toBe("A3!");
    expect(containerA.innerHTML).toBe("");
    expect(containerB.innerHTML).toBe("B1");

    const RootAV4 = () => "A4";
    tools.register(RootAV4, "RootA");
    await act(() => {
      ReactFreshRuntime.performReactRefresh();
    });
    expect(containerA.innerHTML).toBe("A4");
    expect(containerB.innerHTML).toBe("B1");
  },
};
