import { Children, type ReactNode } from "react";
import { EventEmitter } from "./shared/node-events";

const emitter = new EventEmitter();

const useIsDark = (): boolean => emitter.listeners("theme").length > 0;

/**
 * The callback runs on a path that may not be taken (`children` is one of two
 * alternatives), but the list and record it allocates exist only on that path:
 * their writes are certain, so the parts and slots stay definite instead of
 * each becoming its own decision.
 */
const Cells = ({ children }: { children: ReactNode }) =>
  Children.map(children, (child) => {
    const parts: ReactNode[] = [<em key="lead">lead</em>];
    parts.push(<u key="trail">trail</u>);
    const slots: Record<string, ReactNode> = {};
    for (const name of ["header", "footer"]) slots[name] = <small>{name}</small>;
    return (
      <span>
        {slots.header}
        {parts}
        {child}
        {slots.footer}
      </span>
    );
  });

export const isPartial = true;
export const stateCount = 2;

export default function UncertainPathLocals() {
  const isDark = useIsDark();
  return (
    <div>
      <Cells>{isDark ? <b>dark</b> : <i>light</i>}</Cells>
    </div>
  );
}
