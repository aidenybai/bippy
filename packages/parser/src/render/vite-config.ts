import type { Interpreter } from "../evaluate/interpreter.js";
import { stringifyJson } from "../evaluate/json-stringify.js";
import { awaitedValue } from "../evaluate/promises.js";
import { createScope } from "../evaluate/scope.js";
import { withScope } from "../evaluate/context.js";
import {
  getKnownObjectKeys,
  getObjectProperty,
  objectFromRecord,
  primitiveValue,
  UNDEFINED_VALUE,
  unknownPrimitiveValue,
  unknownValue,
} from "../evaluate/values.js";
import { parseSourceText } from "../parse/parse-source-file.js";
import type { ModuleRecord, StaticValue } from "../types.js";

// Vite's dev server does not rewrite `define`d names in client modules: it
// serves `@vite/env`, which assigns each entry onto `globalThis` before the app
// runs. The assigned value is the config value's *code text* evaluated (a
// string is used verbatim, anything else is `JSON.stringify`d first), which is
// how `define: { X: JSON.stringify(value) }` yields `value` and a bare string
// yields whatever expression it spells.

/** Vite's `ConfigEnv` for the dev server. */
const DEV_CONFIG_ENV = objectFromRecord({
  command: primitiveValue("serve"),
  mode: primitiveValue("development"),
  isSsrBuild: primitiveValue(false),
  isPreview: primitiveValue(false),
});

/** The config's default export resolved as Vite loads it: a callback is called with the dev `ConfigEnv`, a promise awaited. */
export const evaluateViteConfig = (
  interpreter: Interpreter,
  configModule: ModuleRecord,
): StaticValue => {
  const exported = interpreter.evaluateModuleExport(configModule, "default");
  const context = interpreter.createModuleContext(configModule, undefined, "server");
  const config =
    exported.kind === "function"
      ? interpreter.callValue(exported, [DEV_CONFIG_ENV], context, null)
      : exported;
  return awaitedValue(config, null, () => interpreter.timers.drainMicrotasks());
};

const evaluateDefineText = (
  interpreter: Interpreter,
  configModule: ModuleRecord,
  name: string,
  text: string,
): StaticValue => {
  const parsed = parseSourceText(`${configModule.filePath}#define:${name}`, `(${text});`, "js");
  const [statement] = parsed.program.body;
  if (parsed.errors.length > 0 || statement?.type !== "ExpressionStatement") {
    return unknownValue(`vite define \`${name}\` is not an expression: ${text}`);
  }
  const context = withScope(interpreter.createModuleContext(configModule), createScope(null));
  return interpreter.evaluateExpression(statement.expression, context);
};

/** The value `@vite/env` assigns for one `define` entry. */
const evaluateDefineValue = (
  interpreter: Interpreter,
  configModule: ModuleRecord,
  name: string,
  value: StaticValue,
): StaticValue => {
  if (value.kind === "primitive" && value.value === undefined) return UNDEFINED_VALUE;
  const isString =
    (value.kind === "primitive" && typeof value.value === "string") ||
    (value.kind === "unknown-primitive" && value.primitiveType === "string");
  const text = isString
    ? value
    : stringifyJson(value, undefined, undefined, {
        call: (callee, args, thisValue) =>
          interpreter.callValue(callee, args, interpreter.createModuleContext(configModule), null, {
            thisValue,
          }),
      });
  if (text.kind === "primitive" && typeof text.value === "string") {
    return evaluateDefineText(interpreter, configModule, name, text.value);
  }
  if (text.kind === "unknown-primitive" && text.stringShape?.prefix.startsWith('"')) {
    return unknownPrimitiveValue("string", `vite define \`${name}\`: ${text.reason}`);
  }
  return unknownValue(
    `vite define \`${name}\`: ${text.kind === "unknown" || text.kind === "unknown-primitive" ? text.reason : "code text is not static"}`,
  );
};

/** Installs the config's `define` entries on the window as `@vite/env` does before the app's modules run. */
export const applyViteDefines = (interpreter: Interpreter, configModule: ModuleRecord): void => {
  const config = evaluateViteConfig(interpreter, configModule);
  if (config.kind !== "object") return;
  const defines = getObjectProperty(config, "define");
  if (defines.kind !== "object") return;
  const names = (getKnownObjectKeys(defines) ?? [])
    .filter((name) => !name.startsWith("import.meta.env."))
    .sort();
  for (const name of names) {
    interpreter.assignWindowPath(
      name,
      evaluateDefineValue(interpreter, configModule, name, getObjectProperty(defines, name)),
    );
  }
};
