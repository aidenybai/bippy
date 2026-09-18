import { existsSync } from "node:fs";
import type { Interpreter } from "../evaluate/interpreter.js";
import { DEFAULT_STYLED_COMPONENTS_TRANSFORM } from "../evaluate/styled-components-transform.js";
import { getObjectProperty, isKnownString } from "../evaluate/values.js";
import type { StaticRenderer } from "../render/static-renderer.js";

const STORYBOOK_CONFIG_FILES = [
  ".storybook/main.ts",
  ".storybook/main.js",
  ".storybook/main.mts",
  ".storybook/main.mjs",
  ".storybook/main.cts",
  ".storybook/main.cjs",
];

export const applyStorybookCompilerOptions = (
  renderer: StaticRenderer,
  interpreter: Interpreter,
): void => {
  const configPath = STORYBOOK_CONFIG_FILES.map((fileName) => renderer.resolvePath(fileName)).find(
    (candidate) => existsSync(candidate),
  );
  if (configPath === undefined) return;
  const module = renderer.loadModule(configPath);
  if (!module) return;
  const config = interpreter.evaluateModuleExport(module, "default");
  if (config.kind !== "object") return;
  const typescript = getObjectProperty(config, "typescript");
  if (typescript.kind !== "object") return;
  const reactDocgen = getObjectProperty(typescript, "reactDocgen");
  if (!isKnownString(reactDocgen) || reactDocgen.value !== "react-docgen-typescript") return;
  interpreter.styledComponentsTransform = {
    ...DEFAULT_STYLED_COMPONENTS_TRANSFORM,
    fileName: false,
  };
};
