import { Children, isValidElement, useMemo, useState, type ReactNode } from "react";

// A top-level unkeyed fragment whose children are an unknown-length list
// (framer-motion's `AnimatePresence` shape): React drops the fragment itself.

const onlyElements = (children: ReactNode) => {
  const filtered: React.ReactElement[] = [];
  Children.forEach(children, (child) => {
    if (isValidElement(child)) filtered.push(child);
  });
  return filtered;
};

const Presence = ({ children }: { children?: ReactNode }) => {
  const present = useMemo(() => onlyElements(children), [children]);
  const [rendered] = useState(present);
  return (
    <>
      {rendered.map((child) => (
        <section key={child.key}>{child}</section>
      ))}
    </>
  );
};

export default function FragmentRepeat() {
  const [items] = useState<string[]>(() => (window.location.hash ? ["a"] : []));
  return (
    <div>
      <Presence>
        {items.map((item) => (
          <p key={item}>{item}</p>
        ))}
      </Presence>
    </div>
  );
}
