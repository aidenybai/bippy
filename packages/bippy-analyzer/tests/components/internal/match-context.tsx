import { createContext, useContext } from "react";

interface Match {
  id: string;
}

export const MatchContext = createContext<Match[]>([]);
export const LastMatch = () => {
  const matches = useContext(MatchContext);
  const match = matches[matches.length - 1];
  if (!match?.id) throw new Error("missing route id");
  return (
    <main>
      <span>Route:</span>
      {match.id}
    </main>
  );
};
