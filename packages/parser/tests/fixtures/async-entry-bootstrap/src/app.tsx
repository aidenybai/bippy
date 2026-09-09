import { useSyncExternalStore } from "react";
import { sessionStore } from "./session-store";

const Login = () => (
  <form>
    <label>Username</label>
    <input />
  </form>
);

const Notes = ({ user }: { user: string }) => (
  <main>
    <h1>{`${user}'s notes`}</h1>
    <ul>
      <li>first</li>
    </ul>
  </main>
);

export const App = () => {
  const session = useSyncExternalStore(sessionStore.subscribe, sessionStore.get);
  if (!session.isReady) return <p>loading</p>;
  return session.user ? <Notes user={session.user} /> : <Login />;
};
