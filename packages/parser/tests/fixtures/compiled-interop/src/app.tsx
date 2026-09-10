import { api, SessionProvider, useSession } from "proxy-kit";

const Greeting = () => {
  const label = api.greeting.useLabel();
  const session = useSession();
  return (
    <p className={session.status}>
      {label}: {session.data}
    </p>
  );
};

export const App = () => (
  <SessionProvider session="ada">
    <api.Provider>
      <Greeting />
    </api.Provider>
  </SessionProvider>
);
