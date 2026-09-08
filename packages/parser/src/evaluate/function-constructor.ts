import { createHash } from "node:crypto";
import type { SourceLocation, StaticValue } from "../types.js";
import type { Interpreter } from "./interpreter.js";
import { describeValue, unknownValue } from "./values.js";

const SYNTHETIC_MODULE_DIRECTORY = "/<function-constructor>";

const readSourceArgument = (value: StaticValue): string | null => {
  if (value.kind !== "primitive") return null;
  return value.value === undefined ? null : String(value.value);
};

/**
 * `Function(...params, body)` compiles a sloppy-mode function with no closure,
 * modeled as the sole export of a synthetic CommonJS module so the body is
 * interpreted like any other source (`this` there is the global object).
 */
export const constructFunctionFromSource = (
  interpreter: Interpreter,
  args: StaticValue[],
  location: SourceLocation | null,
): StaticValue => {
  const sources = args.map(readSourceArgument);
  const body = sources.length === 0 ? "" : sources.at(-1);
  if (body === null || body === undefined || sources.includes(null)) {
    return unknownValue(`Function(${args.map(describeValue).join(", ")})`, location);
  }
  const parameters = sources.slice(0, -1).join(", ");
  const sourceText = `module.exports = function anonymous(${parameters}\n) {\n${body}\n};`;
  const filePath = `${SYNTHETIC_MODULE_DIRECTORY}/${createHash("sha1").update(sourceText).digest("hex")}.js`;
  const module = interpreter.graph.addVirtualModule(filePath, sourceText);
  return module
    ? interpreter.evaluateModuleExport(module, "default")
    : unknownValue(`Function() body does not parse: ${body}`, location);
};
