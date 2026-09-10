import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

const Registry = createContext<(name: string) => void>(() => {});

const Layout = ({ children }: { children: ReactNode }) => {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [register] = useState(
    () => (name: string) =>
      setCounts((current) => ({ ...current, [name]: (current[name] ?? 0) + 1 })),
  );
  const names = Object.keys(counts);
  return (
    <Registry.Provider value={register}>
      {window.innerWidth < 0 ? <nav>{children}</nav> : <header>{children}</header>}
      <footer>
        {names.map((name) => (
          <em key={name}>
            {name}:{counts[name]}
          </em>
        ))}
      </footer>
    </Registry.Provider>
  );
};

const Widget = ({ name }: { name: string }) => {
  const register = useContext(Registry);
  useEffect(() => {
    register(name);
  }, [name, register]);
  return <p>{name}</p>;
};

const App = () => (
  <Layout>
    <Widget name="chart" />
    <Widget name="table" />
  </Layout>
);

createRoot(document.getElementById("root")!).render(<App />);
