import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

interface RegistryValue {
  names: string[];
  register: (name: string) => void;
}

const Registry = createContext<RegistryValue>({ names: [], register: () => {} });
const Placement = createContext("header");

const Layout = ({ children }: { children: ReactNode }) => {
  const [names, setNames] = useState<string[]>([]);
  const [register] = useState(
    () => (name: string) =>
      setNames((current) => (current.includes(name) ? current : [...current, name])),
  );
  return (
    <Registry.Provider value={{ names, register }}>
      {window.innerWidth < 0 ? (
        <Placement.Provider value="nav">
          <nav>{children}</nav>
        </Placement.Provider>
      ) : (
        <header>{children}</header>
      )}
      <footer>
        {names.map((name) => (
          <em key={name}>{name}</em>
        ))}
      </footer>
    </Registry.Provider>
  );
};

const Widget = ({ name }: { name: string }) => {
  const { register } = useContext(Registry);
  const placement = useContext(Placement);
  useEffect(() => {
    register(`${placement}-${name}`);
  }, [name, placement, register]);
  return <p>{name}</p>;
};

const layout = (
  <Layout>
    <Widget name="chart" />
  </Layout>
);

const App = () => {
  const [isReady, setIsReady] = useState(false);
  useEffect(() => {
    setIsReady(true);
  }, []);
  return isReady ? <section>{layout}</section> : <div>{layout}</div>;
};

createRoot(document.getElementById("root")!).render(<App />);
