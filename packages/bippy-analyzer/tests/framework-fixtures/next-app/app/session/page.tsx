import { SessionProvider } from "next-auth/react";

const SessionPage = () => (
  <SessionProvider>
    <main>Signed out</main>
  </SessionProvider>
);

export default SessionPage;
