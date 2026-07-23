import React from "react";
import { createRoot } from "react-dom/client";

import type { ConditionalHooksInstallation } from "bippy/conditional-hooks";

import "./styles.css";

interface ApplicationProperties {
  installation: ConditionalHooksInstallation;
}

interface ConditionalDemoProperties {
  onEvent: (message: string) => void;
}

interface EventEntry {
  id: number;
  message: string;
  time: string;
}

const DEMO_SOURCE_LINES = [
  "const ConditionalCounter = () => {",
  "  const [enabled, setEnabled] = React.useState(false)",
  "",
  "  let panel = <p>The branch is off.</p>",
  "",
  "  if (enabled) {",
  "    const [count, setCount] = React.useState(0)",
  "    const [step, changeStep] = React.useReducer(",
  "      (current, direction) => Math.max(1, current + direction),",
  "      1,",
  "    )",
  "    const renders = React.useRef(0)",
  "    const result = React.useMemo(() => count * step, [count, step])",
  "",
  "    React.useEffect(() => {",
  '      const timer = setInterval(() => console.log("tick"), 1000)',
  "      return () => clearInterval(timer)",
  "    }, [])",
  "",
  "    renders.current++",
  "    panel = (",
  "      <div>",
  "        <p>{count} × {step} = {result}</p>",
  "        <button onClick={() => setCount(count + step)}>add</button>",
  "        <button onClick={() => changeStep(1)}>step +</button>",
  "        <small>render {renders.current}</small>",
  "      </div>",
  "    )",
  "  }",
  "",
  "  return (",
  "    <>",
  "      <button onClick={() => setEnabled(!enabled)}>toggle</button>",
  "      {panel}",
  "    </>",
  "  )",
  "}",
];

let eventIdentifier = 0;

const formatTime = (): string =>
  new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date());

const ConditionalDemo = ({ onEvent }: ConditionalDemoProperties): React.ReactNode => {
  const [isEnabled, setIsEnabled] = React.useState(false);
  const [activationCount, setActivationCount] = React.useState(0);

  const toggleDemo = (): void => {
    setIsEnabled((currentIsEnabled) => {
      const nextIsEnabled = !currentIsEnabled;
      if (nextIsEnabled) setActivationCount((currentCount) => currentCount + 1);
      onEvent(nextIsEnabled ? "entered the conditional branch" : "left the conditional branch");
      return nextIsEnabled;
    });
  };

  let demoContent: React.ReactNode = (
    <div className="branch-off">
      <strong>The conditional block is not running.</strong>
      <span>Lines 6–29 are currently skipped.</span>
    </div>
  );

  if (isEnabled) {
    const [count, setCount] = React.useState(0);
    const [step, changeStep] = React.useReducer(
      (currentStep: number, direction: number) => Math.max(1, currentStep + direction),
      1,
    );
    const renderCount = React.useRef(0);
    const [heartbeat, setHeartbeat] = React.useState(0);
    const computedValue = React.useMemo(() => count * step, [count, step]);

    renderCount.current++;

    React.useLayoutEffect(() => {
      onEvent("layout effect mounted");
      return () => onEvent("layout effect cleaned up");
    }, []);

    React.useEffect(() => {
      onEvent("effect timer started");
      const intervalIdentifier = window.setInterval(() => {
        setHeartbeat((currentHeartbeat) => currentHeartbeat + 1);
      }, 1000);
      return () => {
        window.clearInterval(intervalIdentifier);
        onEvent("effect timer stopped");
      };
    }, []);

    demoContent = (
      <div className="branch-on">
        <div className="equation">
          <strong>{count}</strong>
          <span>×</span>
          <strong>{step}</strong>
          <span>=</span>
          <strong>{computedValue}</strong>
        </div>

        <div className="button-row">
          <button className="primary-button" onClick={() => setCount((value) => value + step)}>
            add {step}
          </button>
          <button onClick={() => changeStep(-1)}>step −</button>
          <button onClick={() => changeStep(1)}>step +</button>
          <button onClick={() => setCount(0)}>reset count</button>
        </div>

        <div className="runtime-row">
          <span>
            <i className="status-dot" />
            effect tick {heartbeat}
          </span>
          <span>render {renderCount.current}</span>
        </div>
      </div>
    );
  }

  return (
    <section className="demo-section">
      <div className="section-heading">
        <div>
          <span className="section-number">02</span>
          <h2>Run the component</h2>
        </div>
        <span>{activationCount} branch activations</span>
      </div>

      <ol className="instructions">
        <li>Turn the branch on.</li>
        <li>Change the count and step.</li>
        <li>Turn it off, then on again. The state comes back.</li>
      </ol>

      <div className="toggle-row">
        <div>
          <strong>Run lines 6–29</strong>
          <span>{isEnabled ? "The conditional hooks are mounted." : "The hooks are skipped."}</span>
        </div>
        <button
          className={isEnabled ? "switch enabled" : "switch"}
          aria-label="Toggle conditional hook branch"
          aria-pressed={isEnabled}
          onClick={toggleDemo}
        >
          <span />
        </button>
      </div>

      <div className={isEnabled ? "demo-surface enabled" : "demo-surface"}>{demoContent}</div>
    </section>
  );
};

const Application = ({ installation }: ApplicationProperties): React.ReactNode => {
  const [events, setEvents] = React.useState<EventEntry[]>([]);

  const addEvent = React.useCallback((message: string): void => {
    setEvents((currentEvents) => [
      {
        id: ++eventIdentifier,
        message,
        time: formatTime(),
      },
      ...currentEvents.slice(0, 5),
    ]);
  }, []);

  return (
    <main className="page-shell">
      <header className="intro">
        <div className="brand-row">
          <span className="brand-mark">b</span>
          <strong>bippy</strong>
          <span className="connection-status">
            <span className="status-dot" />
            {installation.supportedRenderers} renderer connected
          </span>
        </div>
        <h1>Conditional hooks, explained</h1>
        <p>
          React normally requires every hook to run in the same order. This experiment lets the
          highlighted hooks exist only while the <code>if</code> branch is enabled.
        </p>
        <div className="comparison-row">
          <span>Normal React</span>
          <strong>conditional hooks break</strong>
          <span>With this runtime</span>
          <strong>each callsite keeps its own state</strong>
        </div>
      </header>

      <section className="source-section">
        <div className="section-heading">
          <div>
            <span className="section-number">01</span>
            <h2>Read the full component</h2>
          </div>
          <span>conditional-counter.tsx</span>
        </div>
        <p className="section-description">
          The highlighted block violates the Rules of Hooks on purpose. It contains state, a
          reducer, a ref, a memo, and an effect.
        </p>
        <pre className="source-code" aria-label="Full conditional counter source code">
          <code>
            {DEMO_SOURCE_LINES.map((sourceLine, sourceLineIndex) => {
              const lineNumber = sourceLineIndex + 1;
              const isConditionalLine = lineNumber >= 6 && lineNumber <= 29;
              return (
                <span
                  className={isConditionalLine ? "source-line highlighted" : "source-line"}
                  key={lineNumber}
                >
                  <span className="line-number">{lineNumber}</span>
                  <span>{sourceLine || " "}</span>
                </span>
              );
            })}
          </code>
        </pre>
        <div className="legend">
          <span className="legend-swatch" />
          This entire block appears and disappears between renders.
        </div>
      </section>

      <ConditionalDemo onEvent={addEvent} />

      <section className="log-section">
        <div className="section-heading">
          <div>
            <span className="section-number">03</span>
            <h2>Watch React commit it</h2>
          </div>
          <span>live effect log</span>
        </div>
        <p className="section-description">
          Entering starts the effects. Leaving cleans them up. Re-entering restores the previous
          count and step instead of creating new state.
        </p>
        <div className="event-list" aria-live="polite">
          {events.length === 0 ? (
            <p className="empty-log">Toggle the branch to see commit activity.</p>
          ) : (
            events.map((event) => (
              <div className="event-row" key={event.id}>
                <span>{event.message}</span>
                <time>{event.time}</time>
              </div>
            ))
          )}
        </div>
      </section>

      <footer>
        <span>runtime experiment</span>
        <span>development build</span>
        <a href="https://github.com/aidenybai/bippy">GitHub</a>
      </footer>
    </main>
  );
};

export const startApplication = (installation: ConditionalHooksInstallation): void => {
  const rootElement = document.querySelector("#root");
  if (!rootElement) throw new Error("Missing root element.");
  createRoot(rootElement).render(
    <React.StrictMode>
      <Application installation={installation} />
    </React.StrictMode>,
  );
};
