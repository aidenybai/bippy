import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vite-plus/test";
import { formatPattern, getRenderPattern } from "../src/harness/static-pattern.js";
import { createStaticRenderer } from "../src/index.js";

it.each([
  { packageName: "mobx-react", useSource: false },
  { packageName: "mobx-react", useSource: true },
  { packageName: "mobx-react-lite", useSource: false },
  { packageName: "mobx-react-lite", useSource: true },
])(
  "keeps modeled $packageName exports while source opt-in is $useSource",
  async ({ packageName, useSource }) => {
    const directory = mkdtempSync(join(tmpdir(), "bippy-mobx-source-"));
    try {
      const packageDirectory = join(directory, "node_modules", packageName);
      mkdirSync(packageDirectory, { recursive: true });
      writeFileSync(
        join(packageDirectory, "package.json"),
        JSON.stringify({ name: packageName, main: "index.tsx" }),
      );
      writeFileSync(
        join(packageDirectory, "index.tsx"),
        `import React from "react";
       globalThis.__bippyMobxSourceProbe = true;
       export const Provider = ({ children }) => <section><span />source-provider{children}</section>;
       export const observer = () => { throw new Error("modeled observer was replaced"); };
       export const isUsingStaticRendering = () => true;`,
      );
      writeFileSync(
        join(directory, "reexports.ts"),
        `export * as bindings from ${JSON.stringify(packageName)};`,
      );
      const entryFile = join(directory, "app.tsx");
      writeFileSync(
        entryFile,
        `import React from "react";
       import * as bindings from ${JSON.stringify(packageName)};
       import { observer, isUsingStaticRendering } from ${JSON.stringify(packageName)};
       import { bindings as reexported } from "./reexports";
       const required = require(${JSON.stringify(packageName)});
       const spread = { ...bindings };
       const Observed = observer(() => <p><i />observed</p>);
       const Namespaced = bindings.observer(() => <p><i />namespaced</p>);
       const Dynamic = () => {
         const [setting, setSetting] = React.useState("pending");
         React.useEffect(() => {
           import(${JSON.stringify(packageName)}).then((namespace) => {
             setSetting(namespace.isUsingStaticRendering() ? "dynamic-true" : "dynamic-false");
           });
         }, []);
         return <label><i />{setting}</label>;
       };
       export default () => <bindings.Provider>
         <Observed /><Namespaced /><Dynamic /><b />{String(isUsingStaticRendering())}
         <b />{String(bindings.isUsingStaticRendering())}
         <b />{String(required.isUsingStaticRendering())}
         <b />{String(spread.isUsingStaticRendering())}
         <b />{String(reexported.isUsingStaticRendering())}
       </bindings.Provider>;`,
      );
      const renderer = await createStaticRenderer({
        rootDirectory: directory,
        externalPackageAllowList: useSource ? [packageName] : [],
      });
      const result = await renderer.renderComponent(entryFile);
      const tree = formatPattern(getRenderPattern(result));
      expect(tree).toContain('"observed"');
      expect(tree).toContain('"namespaced"');
      expect(tree.match(/"false"/g)).toHaveLength(useSource ? 5 : 4);
      expect(tree).toContain('"dynamic-false"');
      expect(tree).not.toContain('"dynamic-true"');
      expect(tree).not.toContain("modeled observer was replaced");
      expect(tree.includes('"source-provider"')).toBe(useSource);
      expect(Reflect.has(globalThis, "__bippyMobxSourceProbe")).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
