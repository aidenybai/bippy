import { useState } from "react";

interface Theme {
  classNames?: { card?: string };
}

interface Page {
  items: string[];
}

const cn = (...classes: Array<string | undefined>) => classes.filter(Boolean).join(" ");

export const Card = ({ theme, note }: { theme?: Theme; note?: string }) => (
  <div className={cn("card", theme?.classNames?.card)}>{note ? <p>{note}</p> : null}</div>
);

export const Feed = ({ pages }: { pages?: Page[] }) => {
  const items = pages?.flatMap((page) => page.items);
  if (!items?.length) return <p>Nothing yet</p>;
  return <p>{items.length} items</p>;
};

export const Panels = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [isDark, setIsDark] = useState(false);
  return (
    <div>
      <button onClick={() => setIsOpen(!isOpen)}>Details</button>
      {isOpen && <p>More details</p>}
      <button onClick={() => setIsDark(!isDark)}>Theme</button>
      {isDark ? <span>Dark</span> : <span>Light</span>}
    </div>
  );
};
