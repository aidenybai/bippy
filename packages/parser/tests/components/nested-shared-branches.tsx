import { EventEmitter } from "./shared/node-events";

/** The listener comes out of an opaque module, so nothing about it is known statically. */
const emitter = new EventEmitter();

const useIsDark = (): boolean => emitter.listeners("theme").length > 0;

/**
 * Three levels of components re-test one decision. Taking either side of the
 * outer branch settles every inner test, so nothing here is ever nested more
 * than one alternative away from the preferred path.
 */
const Swatch = () => {
  const isDark = useIsDark();
  return <p>{isDark ? "dark" : "light"}</p>;
};

const Panel = () => {
  const isDark = useIsDark();
  return <section>{isDark ? <Swatch /> : <em>light panel</em>}</section>;
};

const DarkPage = () => {
  const isDark = useIsDark();
  return <div className="dark">{isDark ? <Panel /> : <span>unreachable</span>}</div>;
};

const LightPage = () => {
  const isDark = useIsDark();
  return <div className="light">{!isDark ? <Panel /> : <span>unreachable</span>}</div>;
};

export const isPartial = true;
export const stateCount = 2;

export default function NestedSharedBranches() {
  const isDark = useIsDark();
  return isDark ? <DarkPage /> : <LightPage />;
}
