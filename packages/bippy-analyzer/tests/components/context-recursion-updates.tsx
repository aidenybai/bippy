import { createContext, memo, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

const DepthContext = createContext(0);

const renderNested = (): ReactNode => {
  const depth = useContext(DepthContext);
  if (depth === 3)
    return (
      <span>
        {"depth: "}
        {depth}
      </span>
    );
  return (
    <DepthContext.Provider value={depth + 1}>
      <section>
        <Nested />
      </section>
    </DepthContext.Provider>
  );
};

const Nested = memo(renderNested);

export default () => {
  const [depth, setDepth] = useState(0);
  useEffect(() => setDepth(1), []);
  return (
    <DepthContext.Provider value={depth}>
      <Nested />
    </DepthContext.Provider>
  );
};

export const isExact = true;
