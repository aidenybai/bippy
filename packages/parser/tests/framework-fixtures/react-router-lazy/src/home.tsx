import { loadedModules } from "./registry";

export const Home = () => (
  <h1>{loadedModules.includes("heavy") ? <em>heavy loaded</em> : <strong>home only</strong>}</h1>
);
