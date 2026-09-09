import { createRoot } from "react-dom/client";

const normalizeBasePath = (pathname: string): string => pathname.replace(/\/+$/, "");

const getBasePath = (): string =>
  normalizeBasePath(new URL(document.baseURI || window.location.href).pathname);

const getEdition = (): string =>
  document.querySelector('meta[name="app-edition"]')?.getAttribute("content") ?? "unknown";

const App = () => {
  const basePath = getBasePath();
  return (
    <main>
      <p>
        {"base path: "}
        {basePath === "" ? "(origin)" : basePath}
      </p>
      <p>
        {getEdition()}
        {" edition"}
      </p>
    </main>
  );
};

createRoot(document.getElementById("root")!).render(<App />);
