import type { ReactNode } from "react";
import { Boundary } from "./internal/reducer-error-boundary";
import { LastMatch, MatchContext } from "./internal/match-context";

const Routes = () => {
  const routes = [{ id: "root" }, { id: "child" }];
  const index = routes.findIndex(() => Math.random() > 0.5);
  const matches = routes.slice(0, Math.min(routes.length, index + 1));
  return matches.reduceRight<ReactNode>(
    (children, match, position) => (
      <MatchContext.Provider key={match.id} value={[...matches.slice(0, position + 1)]}>
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
