import type { ReactNode } from "react";
import { Boundary } from "./internal/reducer-error-boundary";
import { LastMatch, MatchContext } from "./internal/match-context";

const Routes = () => {
  const matches = Math.random() > 0.5 ? [] : [{ id: "root" }, { id: "child" }];
  const visible = Math.random() > 0.5 ? [] : [true];
  return matches.reduceRight<ReactNode>(
    (children, match, index) => (
      <div key={match.id}>
        {visible.map(() => (
          <MatchContext.Provider key="visible" value={[...matches.slice(0, index + 1)]}>
            <LastMatch />
          </MatchContext.Provider>
        ))}
        {children}
      </div>
    ),
    null,
  );
};

export default () => (
  <Boundary>
    <Routes />
  </Boundary>
);
