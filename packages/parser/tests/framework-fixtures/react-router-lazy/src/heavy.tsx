import { loadedModules } from "./registry";

loadedModules.push("heavy");

export const Heavy = () => <h1>{loadedModules.length}</h1>;
