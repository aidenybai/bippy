import * as React from "react";
import * as TestRenderer from "react-test-renderer";

interface Flags {
  enabled: boolean;
  details: boolean;
}

const FlagsContext = React.createContext<Flags>({ enabled: false, details: false });
const events: string[] = [];
let renderer: ReturnType<typeof TestRenderer.create> | undefined;
let renders = 0;

const Content = () => {
  const flags = React.useContext(FlagsContext);
  const [count, setCount] = React.useState(0);
  const commits = React.useRef(0);
  const label = flags.enabled ? "Enabled" : "Disabled";
  renders++;
  React.useLayoutEffect(() => {
    commits.current++;
    events.push(`commit:${label}:${count}`);
    return () => {
      events.push(`cleanup:${label}:${count}`);
    };
  }, [flags, count]);
  return (
    <section data-status={flags.enabled ? "enabled" : "disabled"}>
      <h1>{label}</h1>
      <button disabled={!flags.enabled} onClick={() => setCount((previous) => previous + 1)}>
        {count}
      </button>
      {flags.details ? (
        <aside key="details">
          {flags.enabled ? <strong>Active details</strong> : <span>Inactive details</span>}
        </aside>
      ) : null}
    </section>
  );
};

export const mount = () => {
  renderer = TestRenderer.create(
    <FlagsContext value={{ enabled: false, details: false }}>
      <Content />
    </FlagsContext>,
  );
};

export const update = (enabled: boolean, details: boolean) => {
  if (!renderer) throw Error("Missing renderer");
  const current = renderer;
  Reflect.apply(Reflect.get(current, "unstable_flushSync"), current, [
    () => {
      current.update(
        <FlagsContext value={{ enabled, details }}>
          <Content />
        </FlagsContext>,
      );
    },
  ]);
};

export const observe = () => JSON.stringify({ tree: renderer?.toJSON(), renders, events });
export const unmount = () => renderer?.unmount();
export const versions = [React.version, "version" in TestRenderer ? TestRenderer.version : null];
