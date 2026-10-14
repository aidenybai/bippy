import MagicString from "magic-string";
import { parseAst } from "vite";
import type { Plugin, Rollup } from "vite";
import type { Probe } from "../types";
import { isAppSourceModule, stripQuery } from "./packages";

interface RequireCall {
  start: number;
  end: number;
  specifier: string;
}

const SERVER_DIRECTIVE = "use server";

const getExportNames = (program: Rollup.ProgramNode): string[] =>
  program.body.flatMap((statement) => {
    if (statement.type === "ExportDefaultDeclaration") return ["default"];
    if (statement.type !== "ExportNamedDeclaration") return [];
    const { declaration, specifiers } = statement;
    const declared =
      declaration?.type === "VariableDeclaration"
        ? declaration.declarations.flatMap((declarator) =>
            declarator.id.type === "Identifier" ? [declarator.id.name] : [],
          )
        : declaration && "id" in declaration && declaration.id
          ? [declaration.id.name]
          : [];
    return [
      ...declared,
      ...specifiers.map((specifier) =>
        specifier.exported.type === "Identifier"
          ? specifier.exported.name
          : String(specifier.exported.value),
      ),
    ];
  });

export const createServerActionPlugin = (): Plugin => ({
  name: "bippy-verify-server-actions",
  transform: (code) => {
    if (!code.includes(SERVER_DIRECTIVE)) return null;
    const program = parseAst(code);
    const [firstStatement] = program.body;
    if (
      firstStatement?.type !== "ExpressionStatement" ||
      !("directive" in firstStatement) ||
      firstStatement.directive !== SERVER_DIRECTIVE
    )
      return null;
    return getExportNames(program)
      .map((name) =>
        name === "default"
          ? "export default async () => undefined;"
          : `export const ${name} = async () => undefined;`,
      )
      .join("\n");
  },
});

const getRequireCall = (node: object): RequireCall | null => {
  const callee: unknown = Reflect.get(node, "callee");
  const callArguments: unknown = Reflect.get(node, "arguments");
  if (Reflect.get(node, "type") !== "CallExpression" || !Array.isArray(callArguments)) return null;
  const [specifierNode]: unknown[] = callArguments;
  const specifier: unknown =
    callArguments.length === 1 && typeof specifierNode === "object" && specifierNode !== null
      ? Reflect.get(specifierNode, "value")
      : null;
  const start: unknown = Reflect.get(node, "start");
  const end: unknown = Reflect.get(node, "end");
  const isRequire =
    typeof callee === "object" && callee !== null && Reflect.get(callee, "name") === "require";
  return isRequire &&
    typeof specifier === "string" &&
    typeof start === "number" &&
    typeof end === "number"
    ? { start, end, specifier }
    : null;
};

const findRequireCalls = (program: Rollup.ProgramNode): RequireCall[] => {
  const calls: RequireCall[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (typeof node !== "object" || node === null) return;
    const call = getRequireCall(node);
    if (call) calls.push(call);
    else Object.values(node).forEach(visit);
  };
  visit(program);
  return calls;
};

const isModuleStatement = (statement: Rollup.ProgramNode["body"][number]): boolean =>
  statement.type === "ImportDeclaration" ||
  statement.type === "ExportNamedDeclaration" ||
  statement.type === "ExportDefaultDeclaration" ||
  statement.type === "ExportAllDeclaration";

export const createCommonJsPlugin = (): Plugin => ({
  name: "bippy-verify-commonjs",
  transform: (code, id) => {
    if (!isAppSourceModule(id) || !code.includes("module.exports")) return null;
    if (parseAst(code).body.some(isModuleStatement)) return null;
    return [
      "const module = { exports: {} };",
      "const exports = module.exports;",
      code,
      "export default module.exports;",
    ].join("\n");
  },
});

export const createRequirePlugin = (): Plugin => ({
  name: "bippy-verify-require",
  transform: (code, id) => {
    if (!isAppSourceModule(id) || !code.includes("require(")) return null;
    const calls = findRequireCalls(parseAst(code));
    if (calls.length === 0) return null;
    const specifiers = [...new Set(calls.map((call) => call.specifier))];
    const source = new MagicString(code);
    for (const call of calls) {
      const name = `__bippyRequire${specifiers.indexOf(call.specifier)}`;
      source.overwrite(call.start, call.end, `(${name}.default ?? ${name})`);
    }
    source.prepend(
      specifiers
        .map(
          (specifier, index) =>
            `import * as __bippyRequire${index} from ${JSON.stringify(specifier)};\n`,
        )
        .join(""),
    );
    return { code: source.toString(), map: source.generateMap({ hires: true }) };
  },
});

export const createProbePlugin = (probes: Probe[]): Plugin => {
  const probesByFile = Map.groupBy(probes, (probe) => probe.file);
  return {
    name: "bippy-verify-probes",
    enforce: "pre",
    transform: (code, id) => {
      const fileProbes = probesByFile.get(stripQuery(id));
      if (!fileProbes) return null;
      const source = new MagicString(code);
      const innermostFirst = [...fileProbes].sort(
        (left, right) => left.end - left.start - (right.end - right.start),
      );
      for (const probe of innermostFirst) {
        source.prependRight(
          probe.start,
          `__bippyProbe(${JSON.stringify(probe.id)}, ${JSON.stringify(probe.mode)}, (`,
        );
        source.appendLeft(probe.end, "))");
      }
      return { code: source.toString(), map: source.generateMap({ hires: true }) };
    },
  };
};
