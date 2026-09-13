import message from "./message.fixture";

Reflect.set(globalThis, "__bippyEnvironmentApplicationRan", true);

const App = () => (
  <main>
    environment: {message} label: {import.meta.env.VITE_LABEL}
  </main>
);

export default App;
