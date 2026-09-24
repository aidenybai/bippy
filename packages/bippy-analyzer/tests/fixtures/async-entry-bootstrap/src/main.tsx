import { createRoot } from "react-dom/client";
import { App } from "./app";
import { sessionStore } from "./session-store";

const readStoredUser = (): Promise<string> =>
  new Promise((resolve) => {
    setTimeout(() => resolve("ada"), 1);
  });

const setup = async () => {
  const user = await readStoredUser();
  await Promise.resolve();
  sessionStore.set({ user, isReady: true });
  const root = createRoot(document.getElementById("root")!);
  root.render(<App />);
};

setup();
