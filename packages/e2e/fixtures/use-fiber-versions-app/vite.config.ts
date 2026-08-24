import { dirname } from "node:path";
import { createRequire } from "node:module";
import { defineConfig } from "vite";

const packageRequire = createRequire(import.meta.url);
const reactVersion = process.env.REACT_VERSION;
if (reactVersion !== "17" && reactVersion !== "18") {
  throw new Error("REACT_VERSION must be 17 or 18");
}
const reactPackageName = `react-${reactVersion}`;
const reactDOMPackageName = `react-dom-${reactVersion}`;
const reactDirectory = dirname(packageRequire.resolve(`${reactPackageName}/package.json`));
const reactDOMDirectory = dirname(packageRequire.resolve(`${reactDOMPackageName}/package.json`));

export default defineConfig({
  resolve: {
    alias: {
      react: reactDirectory,
      "react-dom": reactDOMDirectory,
    },
  },
});
