import { queryOptions, useQueryClient } from "@tanstack/react-query";
import { getFlags, getSession, type Session as SessionData } from "auth-sdk";
import { useEffect, useState } from "react";
import { Session } from "./session";

interface Settled<T> {
  status: "pending" | "success" | "error";
  data?: T;
  error?: Error;
}

const sessionQueryOptions = queryOptions({
  queryKey: ["session"],
  queryFn: getSession,
});

const flagsQueryOptions = queryOptions({
  queryKey: ["flags", { scope: "app" }],
  queryFn: getFlags,
});

export const App = () => {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Settled<SessionData>>({ status: "pending" });
  const [flags, setFlags] = useState<Settled<string[]>>({ status: "pending" });
  useEffect(() => {
    queryClient.fetchQuery(sessionQueryOptions).then(
      (data) => setSession({ status: "success", data }),
      (error: Error) => setSession({ status: "error", error }),
    );
    queryClient.fetchQuery(flagsQueryOptions).then(
      (data) => setFlags({ status: "success", data }),
      (error: Error) => setFlags({ status: "error", error }),
    );
  }, [queryClient]);
  if (session.status === "pending" || flags.status === "pending") {
    return <p className="loading">loading</p>;
  }
  return (
    <main>
      {session.data ? <Session name={session.data.user.name} /> : <p>signed out</p>}
      {flags.status === "error" ? (
        <p className="error">{flags.error?.message}</p>
      ) : (
        <ul>
          {flags.data?.map((flag) => (
            <li key={flag}>{flag}</li>
          ))}
        </ul>
      )}
    </main>
  );
};
