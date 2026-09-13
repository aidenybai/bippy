import { createContext, memo, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

const ParentContext = createContext("root");
const ChildContext = createContext("child");
let instanceCount = 0;
let childRenderCount = 0;

const renderRecursive = (): ReactNode => {
  const [instance] = useState(() => instanceCount++);
  const [label, setLabel] = useState("initial");
  useEffect(() => {
    if (instance === 0) setLabel("updated");
  }, [instance]);
  if (instance !== 0) {
    const child = useContext(ChildContext);
    childRenderCount++;
    return (
      <p>
        {child}
        {": "}
        {childRenderCount}
      </p>
    );
  }
  const parent = useContext(ParentContext);
  return (
    <ParentContext.Provider value={label}>
      <header>
        {parent}
        {": "}
        {label}
      </header>
      <Recursive />
    </ParentContext.Provider>
  );
};

const Recursive = memo(renderRecursive);

export default () => <Recursive />;
export const isExact = true;
