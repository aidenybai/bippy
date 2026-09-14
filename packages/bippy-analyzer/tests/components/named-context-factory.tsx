import { createContext, type ReactNode, useContext } from "react";

const createNamedContext = (name: string) => {
  const context = createContext<string | null>(null);
  context.displayName = name;
  return context;
};

const HistoryContext = createNamedContext("Router-History");
const RouterContext = createNamedContext("Router");

const Reader = () => {
  const history = useContext(HistoryContext);
  const router = useContext(RouterContext);
  return (
    <p>
      {history === null ? <i>no history</i> : <b>{history}</b>}
      {router === null ? <i>no router</i> : <em>{router}</em>}
    </p>
  );
};

const Router = ({ children }: { children: ReactNode }) => (
  <RouterContext.Provider value="router">
    <HistoryContext.Provider value="history">{children}</HistoryContext.Provider>
  </RouterContext.Provider>
);

export const isExact = true;

export default function NamedContextFactory() {
  return (
    <Router>
      <Reader />
    </Router>
  );
}
