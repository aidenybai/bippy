import React from "react";
import { createRoot } from "react-dom/client";

import type { ConditionalHooksInstallation } from "bippy/conditional-hooks";

import "./styles.css";

interface ApplicationProperties {
  installation: ConditionalHooksInstallation;
}

interface ConditionalPanelProperties {
  onEvent: (message: string) => void;
}

interface EventEntry {
  id: number;
  message: string;
  time: string;
}

let eventIdentifier = 0;

const formatTime = (): string =>
  new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date());

const ConditionalPanel = ({ onEvent }: ConditionalPanelProperties): React.ReactNode => {
  const [isBranchEnabled, setIsBranchEnabled] = React.useState(false);
  const [activationCount, setActivationCount] = React.useState(0);

  const toggleBranch = (): void => {
    setIsBranchEnabled((isEnabled) => {
      const nextIsEnabled = !isEnabled;
      if (nextIsEnabled) setActivationCount((count) => count + 1);
      onEvent(nextIsEnabled ? "Branch entered" : "Branch exited");
      return nextIsEnabled;
    });
  };

  let branchContent: React.ReactNode = (
    <div className="empty-state">
      <div className="empty-orbit">
        <span />
      </div>
      <strong>The hook branch is dormant</strong>
      <p>Enable it to call six ordinary React hooks from inside an if statement.</p>
    </div>
  );

  if (isBranchEnabled) {
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
      onEvent("Conditional layout effect mounted");
      return () => onEvent("Conditional layout effect cleaned up");
    }, []);

    React.useEffect(() => {
      onEvent("Conditional interval started");
      const intervalIdentifier = window.setInterval(() => {
        setHeartbeat((value) => value + 1);
      }, 1000);
      return () => {
        window.clearInterval(intervalIdentifier);
        onEvent("Conditional interval stopped");
      };
    }, []);

    branchContent = (
      <div className="active-branch">
        <div className="metrics-grid">
          <article>
            <span>Counter</span>
            <strong>{count}</strong>
          </article>
          <article>
            <span>Step</span>
            <strong>{step}</strong>
          </article>
          <article>
            <span>Count × step</span>
            <strong>{computedValue}</strong>
          </article>
          <article>
            <span>Render pass</span>
            <strong>{renderCount.current}</strong>
          </article>
        </div>

        <div className="controls-row">
          <button className="primary-button" onClick={() => setCount((value) => value + step)}>
            Add {step}
          </button>
          <button className="secondary-button" onClick={() => changeStep(-1)}>
            Step −
          </button>
          <button className="secondary-button" onClick={() => changeStep(1)}>
            Step +
          </button>
          <button className="ghost-button" onClick={() => setCount(0)}>
            Reset
          </button>
        </div>

        <div className="heartbeat-row">
          <span className="heartbeat-dot" />
          Effect heartbeat <strong>{heartbeat}</strong>
        </div>
      </div>
    );
  }

  return (
    <section className="lab-card">
      <div className="card-heading">
        <div>
          <span className="eyebrow">Live Fiber experiment</span>
          <h2>Conditional branch</h2>
        </div>
        <button
          className={isBranchEnabled ? "toggle enabled" : "toggle"}
          aria-pressed={isBranchEnabled}
          onClick={toggleBranch}
        >
          <span />
          {isBranchEnabled ? "Enabled" : "Disabled"}
        </button>
      </div>

      <div className="branch-stage">{branchContent}</div>

      <footer className="card-footer">
        <span>Branch activations</span>
        <strong>{activationCount}</strong>
        <span className="retention-note">State survives while disabled</span>
      </footer>
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
      ...currentEvents.slice(0, 7),
    ]);
  }, []);

  return (
    <main className="page-shell">
      <header className="hero">
        <div className="status-pill">
          <span />
          {installation.supportedRenderers} development renderer connected
        </div>
        <h1>
          Conditional hooks,
          <br />
          <em>actually running.</em>
        </h1>
        <p>
          Bippy proxies React’s active dispatcher, keys ordinary hooks by callsite, and stores their
          state beside the current Fiber instead of consuming React’s positional hook list.
        </p>
      </header>

      <div className="workspace-grid">
        <ConditionalPanel onEvent={addEvent} />

        <aside className="side-stack">
          <section className="code-card">
            <div className="window-bar">
              <span />
              <span />
              <span />
              <small>component.tsx</small>
            </div>
            <pre>
              <code>
                <span className="syntax-purple">if</span> (enabled) {`{`}
                {"\n"} <span className="syntax-purple">const</span> [count, setCount] ={"\n"} React.
                <span className="syntax-blue">useState</span>(0)
                {"\n\n"} React.<span className="syntax-blue">useEffect</span>(() ={">"} {`{`}
                {"\n"} <span className="syntax-purple">return</span> subscribe()
                {"\n"} {`}`}, [])
                {"\n"}
                {`}`}
              </code>
            </pre>
          </section>

          <section className="events-card">
            <div className="events-heading">
              <div>
                <span className="eyebrow">Commit activity</span>
                <h3>Effect log</h3>
              </div>
              <span className="live-badge">Live</span>
            </div>
            <div className="event-list">
              {events.length === 0 ? (
                <p className="no-events">Toggle the branch to begin.</p>
              ) : (
                events.map((event) => (
                  <div className="event-row" key={event.id}>
                    <span className="event-marker" />
                    <span>{event.message}</span>
                    <time>{event.time}</time>
                  </div>
                ))
              )}
            </div>
          </section>
        </aside>
      </div>

      <footer className="page-footer">
        <span>Development builds only</span>
        <span>Stack-keyed callsites</span>
        <span>Absolutely unsupported</span>
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
