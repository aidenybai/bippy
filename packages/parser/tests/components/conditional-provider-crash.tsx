import { createContext, useContext } from "react";

interface Session {
  name: string;
}

const SessionContext = createContext<Session | null>(null);

const useSession = (): Session => {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession must be used within a SessionProvider");
  return session;
};

const SessionProvider = ({ children }: { children: React.ReactNode }) => {
  const isSignedIn = Date.now() > 0;
  if (!isSignedIn) return children;
  return <SessionContext.Provider value={{ name: "alice" }}>{children}</SessionContext.Provider>;
};

const Greeting = () => {
  const session = useSession();
  return <p>hello {session.name}</p>;
};

export const isPartial = true;

export default function ConditionalProviderCrash() {
  return (
    <SessionProvider>
      <main>
        <Greeting />
      </main>
    </SessionProvider>
  );
}
