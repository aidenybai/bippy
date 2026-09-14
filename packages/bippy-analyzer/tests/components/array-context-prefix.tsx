import type { ReactNode } from "react";
import { Boundary } from "./internal/reducer-error-boundary";
import { LastMatch, MatchContext } from "./internal/match-context";

const Routes = () => {
  const matches = Math.random() > 0.5 ? [] : [{ id: "root" }, { id: "child" }];
  return matches.reduceRight<ReactNode>(
    (children, match, index) => (
      <MatchContext.Provider key={match.id} value={[...matches.slice(0, index + 1)]}>
        <LastMatch />
        {children}
      </MatchContext.Provider>
    ),
    null,
  );
};

export default () => (
  <Boundary>
    <Routes />
  </Boundary>
);
