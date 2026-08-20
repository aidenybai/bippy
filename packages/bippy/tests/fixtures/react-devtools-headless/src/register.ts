import { register } from "./mcp.js";

if (typeof window === "undefined") {
  throw new Error("react-devtools-headless/register requires a browser-like environment");
}

register();

export * from "./mcp.js";
