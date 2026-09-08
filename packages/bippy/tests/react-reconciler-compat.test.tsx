import "../src/index.js"; // KEEP THIS LINE ON TOP

import { describe, expect, it } from "vite-plus/test";
import * as React from "react";

import {
  act,
  assertLog,
  createNoopRoot,
  expectRenderedOutput,
  flushSyncWork,
  log,
} from "./noop-renderer.js";

const Text = ({ text }: { text: unknown }) => {
  log(text);
  return <>{String(text)}</>;
};

describe("ReactFragment (ported from react-reconciler)", () => {
  it("should render a single child via noop renderer", async () => {
    const root = createNoopRoot();
    await act(() =>
      root.render(
        <>
          <span>foo</span>
        </>,
      ),
    );
    expectRenderedOutput(root, <span>foo</span>);
  });

  it("should render zero children via noop renderer", async () => {
    const root = createNoopRoot();
    await act(() => root.render(<React.Fragment />));
    expectRenderedOutput(root, null);
  });

  it("should render multiple children via noop renderer", async () => {
    const root = createNoopRoot();
    await act(() =>
      root.render(
        <>
          hello <span>world</span>
        </>,
      ),
    );
    expectRenderedOutput(
      root,
      <>
        hello <span>world</span>
      </>,
    );
  });

  it("should render an iterable via noop renderer", async () => {
    const root = createNoopRoot();
    await act(() =>
      root.render(<>{new Set([<span key="a">hi</span>, <span key="b">bye</span>])}</>),
    );
    expectRenderedOutput(
      root,
      <>
        <span>hi</span>
        <span>bye</span>
      </>,
    );
  });
});

describe("ReactFiberRefs (ported from react-reconciler)", () => {
  it("ref is attached even if there are no other updates (host component)", async () => {
    const ref1 = React.createRef<HTMLDivElement>();
    const ref2 = React.createRef<HTMLDivElement>();
    const root = createNoopRoot();

    await act(() => root.render(<div ref={ref1}>Hi</div>));
    expectRenderedOutput(root, <div>Hi</div>);
    expect(ref1.current).not.toBe(null);
    expect(ref2.current).toBe(null);

    await act(() => root.render(<div ref={ref2}>Hi</div>));
    expectRenderedOutput(root, <div>Hi</div>);
    expect(ref1.current).toBe(null);
    expect(ref2.current).not.toBe(null);
  });

  it("detaches refs when the component unmounts", async () => {
    const refLog: unknown[] = [];
    const root = createNoopRoot();

    await act(() =>
      root.render(
        <div
          ref={(instance) => {
            refLog.push(instance);
          }}
        />,
      ),
    );
    expect(refLog).toHaveLength(1);
    expect(refLog[0]).not.toBe(null);

    await act(() => root.render(null));
    expect(refLog).toHaveLength(2);
    expect(refLog[1]).toBe(null);
  });
});

describe("ReactClassComponents (ported from react-reconciler)", () => {
  it("setState callback (2nd arg) should only fire once", async () => {
    let app: App | undefined;
    class App extends React.Component {
      state = { step: 0 };
      render() {
        app = this;
        return <Text text={this.state.step} />;
      }
    }

    const root = createNoopRoot();
    await act(() => root.render(<App />));
    assertLog([0]);

    await act(() => {
      app?.setState({ step: 1 }, () => log("Callback 1"));
    });
    assertLog([1, "Callback 1"]);
  });

  it("calls lifecycle methods in the correct order", async () => {
    class Lifecycles extends React.Component<{ step: number }> {
      componentDidMount() {
        log("componentDidMount");
      }
      componentDidUpdate(prevProps: { step: number }) {
        log(`componentDidUpdate from ${prevProps.step} to ${this.props.step}`);
      }
      componentWillUnmount() {
        log("componentWillUnmount");
      }
      render() {
        log("render");
        return <div data-step={this.props.step} />;
      }
    }

    const root = createNoopRoot();
    await act(() => root.render(<Lifecycles step={1} />));
    assertLog(["render", "componentDidMount"]);

    await act(() => root.render(<Lifecycles step={2} />));
    assertLog(["render", "componentDidUpdate from 1 to 2"]);
    expectRenderedOutput(root, <div data-step={2} />);

    await act(() => root.render(null));
    assertLog(["componentWillUnmount"]);
    expectRenderedOutput(root, null);
  });

  it("unmount lifecycle fires for class components nested inside host instances", async () => {
    class Inner extends React.Component {
      componentWillUnmount() {
        log("Inner unmount");
      }
      render() {
        return <span>inner</span>;
      }
    }

    const root = createNoopRoot();
    await act(() =>
      root.render(
        <div>
          <Inner />
        </div>,
      ),
    );

    await act(() => root.render(null));
    assertLog(["Inner unmount"]);
  });
});

describe("ReactHooksWithNoopRenderer (ported from react-reconciler)", () => {
  it("simple mount and update", async () => {
    let counter: { updateCount: React.Dispatch<React.SetStateAction<number>> } | undefined;
    const Counter = () => {
      const [count, updateCount] = React.useState(0);
      counter = { updateCount };
      return <Text text={`Count: ${count}`} />;
    };

    const root = createNoopRoot();
    await act(() => root.render(<Counter />));
    assertLog(["Count: 0"]);
    expectRenderedOutput(root, "Count: 0");

    await act(() => counter?.updateCount(1));
    assertLog(["Count: 1"]);
    expectRenderedOutput(root, "Count: 1");

    await act(() => counter?.updateCount((count) => count + 10));
    assertLog(["Count: 11"]);
    expectRenderedOutput(root, "Count: 11");
  });

  it("returns the same updater function every time", async () => {
    const updaters: React.Dispatch<React.SetStateAction<number>>[] = [];
    const Counter = () => {
      const [count, updateCount] = React.useState(0);
      updaters.push(updateCount);
      return <Text text={`Count: ${count}`} />;
    };

    const root = createNoopRoot();
    await act(() => root.render(<Counter />));
    assertLog(["Count: 0"]);

    await act(() => updaters[0](1));
    assertLog(["Count: 1"]);

    await act(() => updaters[0]((count) => count + 10));
    assertLog(["Count: 11"]);
  });

  it("useReducer: simple mount and update", async () => {
    const INCREMENT = "INCREMENT";
    const DECREMENT = "DECREMENT";
    const reducer = (state: number, action: string): number => {
      switch (action) {
        case INCREMENT:
          return state + 1;
        case DECREMENT:
          return state - 1;
        default:
          return state;
      }
    };

    let dispatchAction: React.Dispatch<string> | undefined;
    const Counter = () => {
      const [count, dispatch] = React.useReducer(reducer, 0);
      dispatchAction = dispatch;
      return <Text text={`Count: ${count}`} />;
    };

    const root = createNoopRoot();
    await act(() => root.render(<Counter />));
    assertLog(["Count: 0"]);

    await act(() => dispatchAction?.(INCREMENT));
    assertLog(["Count: 1"]);

    await act(() => {
      dispatchAction?.(DECREMENT);
    });
    assertLog(["Count: 0"]);
  });

  it("unmounts previous effect", async () => {
    const Counter = ({ count }: { count: number }) => {
      React.useEffect(() => {
        log(`Did create [${count}]`);
        return () => {
          log(`Did destroy [${count}]`);
        };
      });
      return <Text text={`Count: ${count}`} />;
    };

    const root = createNoopRoot();
    await act(() => root.render(<Counter count={0} />));
    assertLog(["Count: 0", "Did create [0]"]);

    await act(() => root.render(<Counter count={1} />));
    assertLog(["Count: 1", "Did destroy [0]", "Did create [1]"]);
  });

  it("flushes passive effects of children before parents", async () => {
    const Child = () => {
      React.useEffect(() => {
        log("Child effect");
      }, []);
      return <span>child</span>;
    };
    const Parent = () => {
      React.useEffect(() => {
        log("Parent effect");
      }, []);
      return <Child />;
    };

    const root = createNoopRoot();
    await act(() => root.render(<Parent />));
    assertLog(["Child effect", "Parent effect"]);
  });

  it("useLayoutEffect fires before useEffect", async () => {
    const App = () => {
      React.useEffect(() => {
        log("passive");
      }, []);
      React.useLayoutEffect(() => {
        log("layout");
      }, []);
      return null;
    };

    const root = createNoopRoot();
    await act(() => root.render(<App />));
    assertLog(["layout", "passive"]);
  });
});

describe("ReactNewContext (ported from react-reconciler)", () => {
  it("propagates through a provider to useContext", async () => {
    const Context = React.createContext(1);

    const Consumer = () => {
      const value = React.useContext(Context);
      return <Text text={`Result: ${value}`} />;
    };

    const App = ({ value }: { value: number }) => (
      <Context.Provider value={value}>
        <Consumer />
      </Context.Provider>
    );

    const root = createNoopRoot();
    await act(() => root.render(<App value={2} />));
    assertLog(["Result: 2"]);
    expectRenderedOutput(root, "Result: 2");

    await act(() => root.render(<App value={3} />));
    assertLog(["Result: 3"]);
    expectRenderedOutput(root, "Result: 3");
  });

  it("should provide the correct (default) values to consumers outside of a provider", async () => {
    const FooContext = React.createContext({ value: "foo-initial" });
    const BarContext = React.createContext({ value: "bar-initial" });

    const FooConsumer = () => {
      const { value } = React.useContext(FooContext);
      return <span>{value}</span>;
    };
    const BarConsumer = () => {
      const { value } = React.useContext(BarContext);
      return <span>{value}</span>;
    };

    const root = createNoopRoot();
    await act(() =>
      root.render(
        <>
          <BarContext.Provider value={{ value: "bar-updated" }}>
            <BarConsumer />
            <FooContext.Provider value={{ value: "foo-updated" }}>
              <FooConsumer />
            </FooContext.Provider>
          </BarContext.Provider>
          <FooConsumer />
          <BarConsumer />
        </>,
      ),
    );
    expectRenderedOutput(
      root,
      <>
        <span>bar-updated</span>
        <span>foo-updated</span>
        <span>foo-initial</span>
        <span>bar-initial</span>
      </>,
    );
  });

  it("supports Context.Consumer render props", async () => {
    const Context = React.createContext("default");

    const root = createNoopRoot();
    await act(() =>
      root.render(
        <Context.Provider value="provided">
          <Context.Consumer>{(value) => <span>{value}</span>}</Context.Consumer>
        </Context.Provider>,
      ),
    );
    expectRenderedOutput(root, <span>provided</span>);
  });
});

describe("ReactFlushSync (ported from react-reconciler)", () => {
  it("flushes pending work synchronously", () => {
    const root = createNoopRoot();
    root.render(<span>sync</span>);
    flushSyncWork();
    expectRenderedOutput(root, <span>sync</span>);
  });
});

describe("ReactIncrementalSideEffects (ported from react-reconciler)", () => {
  it("can update child nodes of a host instance", async () => {
    const Bar = ({ text }: { text: string }) => <span>{text}</span>;
    const Foo = ({ text }: { text: string }) => (
      <div>
        <Bar text={text} />
        {text === "World" ? <Bar text={text} /> : null}
      </div>
    );

    const root = createNoopRoot();
    await act(() => root.render(<Foo text="Hello" />));
    expectRenderedOutput(
      root,
      <div>
        <span>Hello</span>
      </div>,
    );

    await act(() => root.render(<Foo text="World" />));
    expectRenderedOutput(
      root,
      <div>
        <span>World</span>
        <span>World</span>
      </div>,
    );
  });

  it("can deletes children either in the middle, at the beginning or at the end", async () => {
    const Foo = ({ childSet }: { childSet: number[] }) => (
      <div>
        {childSet.map((childIndex) => (
          <span key={childIndex} id={String(childIndex)} />
        ))}
      </div>
    );

    const root = createNoopRoot();
    await act(() => root.render(<Foo childSet={[1, 2, 3, 4, 5]} />));

    await act(() => root.render(<Foo childSet={[1, 2, 4, 5]} />));
    expectRenderedOutput(
      root,
      <div>
        <span id="1" />
        <span id="2" />
        <span id="4" />
        <span id="5" />
      </div>,
    );

    await act(() => root.render(<Foo childSet={[2, 4, 5]} />));
    await act(() => root.render(<Foo childSet={[2, 4]} />));
    expectRenderedOutput(
      root,
      <div>
        <span id="2" />
        <span id="4" />
      </div>,
    );
  });

  it("does not update child nodes if a flush is aborted", async () => {
    const root = createNoopRoot();
    await act(() => root.render(<div data-text="Hello" />));
    await act(() => root.render(<div data-text="Hello" />));
    expectRenderedOutput(root, <div data-text="Hello" />);
  });
});

describe("ReactMemo (ported from react-reconciler)", () => {
  it("renders memo components and re-renders on prop changes", async () => {
    const Counter = React.memo(({ count }: { count: number }) => <Text text={`Count: ${count}`} />);

    const root = createNoopRoot();
    await act(() => root.render(<Counter count={0} />));
    assertLog(["Count: 0"]);
    expectRenderedOutput(root, "Count: 0");

    await act(() => root.render(<Counter count={1} />));
    assertLog(["Count: 1"]);
    expectRenderedOutput(root, "Count: 1");
  });
});
