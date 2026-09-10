import { EventEmitter } from "./shared/node-events";

const emitter = new EventEmitter();

/** An opaque listener may have opened the panel, so everything derived from it is one decision. */
const useIsOpen = (): boolean => emitter.listeners("toggle").length > 0;

interface PanelProps {
  role: string;
  title?: string;
  hidden?: boolean;
}

/** Copies the defined entries the way compiled prop pipelines do, one key at a time. */
const compact = (props: PanelProps | null): Record<string, unknown> => {
  const source: Record<string, unknown> = props ?? {};
  const defined: Record<string, unknown> = {};
  for (const key in source) {
    if (source[key] !== undefined) defined[key] = source[key];
  }
  return defined;
};

/**
 * The enumerated object and the iterated list are each a branch on the same
 * decision: every path enumerates one known collection, and the panel, its
 * label, and the badge agree on which one. Two states, not eight.
 */
const Panel = () => {
  const isOpen = useIsOpen();
  const attributes = compact(isOpen ? { role: "dialog", title: "open", hidden: undefined } : null);
  let label = "";
  for (const action of isOpen ? ["close", "save"] : ["open"]) {
    label += `${action} `;
  }
  return (
    <section {...attributes}>
      <p aria-label={label.trim()}>{label.trim()}</p>
      {isOpen ? <mark>open</mark> : null}
    </section>
  );
};

export const isPartial = true;
export const stateCount = 2;

export default function UncertainEnumeration() {
  return <Panel />;
}
