import { createRoot } from "react-dom/client";

const normalizeBasePath = (pathname: string): string => pathname.replace(/\/+$/, "");

const getBasePath = (): string =>
  normalizeBasePath(new URL(document.baseURI || window.location.href).pathname);

const readMeta = (name: string): string =>
  document.querySelector(`meta[name="${name}"]`)?.getAttribute("content") ?? "unknown";

const App = () => {
  const basePath = getBasePath();
  return (
    <main>
      <p>
        {"base path: "}
        {basePath === "" ? "(origin)" : basePath}
      </p>
      <p>
        {readMeta("app-edition")}
        {" edition"}
      </p>
      <p>
        {"served base: "}
        {readMeta("served-base")}
      </p>
    </main>
  );
};

createRoot(document.getElementById("root")!).render(<App />);
