import { AuthShell } from "auth-shell";

export const App = () => (
  <AuthShell>
    <nav>
      <a href="/">home</a>
      <a href="/pricing">pricing</a>
    </nav>
    <main>
      <h1>welcome</h1>
      <p>the whole page lives inside the provider stack</p>
    </main>
  </AuthShell>
);
