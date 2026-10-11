import { transformSync } from "@babel/core";
import BabelPluginReactCompiler, { printFunctionWithOutlined } from "babel-plugin-react-compiler";
import type { CompilerPipelineValue, LoggerEvent } from "babel-plugin-react-compiler";

export interface UpstreamFunction {
  name: string | null;
  hir: string | null;
  errors: string[];
}

interface Position {
  line: number;
  column: number;
}

/**
 * Identifies a function by where it ends. A function's start differs between the ASTs:
 * Babel starts a function declaration at `function`, TypeScript at its first modifier.
 */
export const getFunctionKey = (end: Position): string => `${end.line}:${end.column}`;

const describeEvent = (event: LoggerEvent): string | null => {
  switch (event.kind) {
    case "CompileError":
      return `${event.detail.category}: ${event.detail.reason}`;
    case "CompileSkip":
      return `Skip: ${event.reason}`;
    case "PipelineError":
    case "CompileUnexpectedThrow":
      return `${event.kind}: ${event.data.split("\n")[0]}`;
    default:
      return null;
  }
};

/**
 * Compiles a file with the real compiler in `infer` mode and lint output, as our pipeline
 * runs, and prints each function's HIR right after `InferReactivePlaces`.
 */
export const compileWithUpstream = (
  fileName: string,
  code: string,
): Map<string, UpstreamFunction> => {
  const functions = new Map<string, UpstreamFunction>();
  const getFunction = (end: Position): UpstreamFunction => {
    const key = getFunctionKey(end);
    const existing = functions.get(key);
    if (existing) return existing;
    const created: UpstreamFunction = { name: null, hir: null, errors: [] };
    functions.set(key, created);
    return created;
  };
  transformSync(code, {
    filename: fileName,
    babelrc: false,
    configFile: false,
    code: false,
    parserOpts: {
      plugins: fileName.endsWith(".ts") ? ["typescript"] : ["typescript", "jsx"],
    },
    plugins: [
      [
        BabelPluginReactCompiler,
        {
          compilationMode: "infer",
          outputMode: "lint",
          panicThreshold: "none",
          logger: {
            logEvent: (_fileName: string | null, event: LoggerEvent) => {
              if (!("fnLoc" in event) || !event.fnLoc) return;
              const description = describeEvent(event);
              if (description) getFunction(event.fnLoc.end).errors.push(description);
            },
            debugLogIRs: (value: CompilerPipelineValue) => {
              if (value.kind !== "hir" || value.name !== "InferReactivePlaces") return;
              const fn = value.value;
              if (typeof fn.loc === "symbol") return;
              const upstreamFunction = getFunction(fn.loc.end);
              upstreamFunction.name = fn.id ?? fn.nameHint;
              upstreamFunction.hir = printFunctionWithOutlined(fn);
            },
          },
        },
      ],
    ],
  });
  return functions;
};
