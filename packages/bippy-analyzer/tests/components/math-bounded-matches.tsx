import { createContext, useContext } from "react";

interface Match {
  id: string;
}

const MatchContext = createContext<Match[]>([]);
const LastMatch = () => {
  const matches = useContext(MatchContext);
  const match = matches[matches.length - 1];
  return (
    <main>
      <span>Route:</span>
      {match.id}
    </main>
  );
};

export default () => {
  const matches = [{ id: "root" }, { id: "child" }, { id: "leaf" }];
  const selected = Math.random() > 0.5 ? 0 : 1;
  const end = Math.min(matches.length, selected + 1);
  return (
    <MatchContext.Provider value={matches.slice(0, end)}>
      <LastMatch />
    </MatchContext.Provider>
  );
};
