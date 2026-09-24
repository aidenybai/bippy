import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseSync, traverse, types, type NodePath } from "@babel/core";
import { transformSync, type Loader } from "esbuild";
import { globSync } from "tinyglobby";
import {
  ensureCorpusCheckout,
  getCheckoutDirectory,
  type CorpusRepository,
} from "./corpus-repositories.js";

export interface CorpusParameter {
  kind: "string" | "number" | "boolean" | "array" | "object" | "function" | "any";
  literals: string[];
  isRest: boolean;
}

export interface CorpusFunction {
  origin: string;
  /** Self-contained statements ending in `const corpusTarget = …;`. */
  source: string;
  parameters: CorpusParameter[];
}

export interface CorpusSourceFile {
  path: string;
  code: string;
}

export interface CorpusExtraction {
  files: number;
  targets: number;
  functions: CorpusFunction[];
  rejections: Record<string, number>;
}

interface CorpusUnit {
  names: string[];
  source: string;
  references: string[];
  rejection: string | null;
}

interface CorpusImport {
  imported: string;
  specifier: string;
}

interface CorpusTarget {
  name: string;
  parameters: CorpusParameter[];
}

interface CorpusModule {
  path: string;
  units: CorpusUnit[];
  unitByName: Map<string, CorpusUnit>;
  imports: Map<string, CorpusImport>;
  exports: Map<string, string>;
  reexports: Map<string, CorpusImport>;
  starExports: string[];
  targets: CorpusTarget[];
}

interface CorpusBinding {
  module: CorpusModule;
  name: string;
}

interface CorpusClosure {
  units: Map<CorpusModule, Set<CorpusUnit>>;
  aliases: Map<CorpusModule, Map<string, CorpusBinding>>;
}

interface UnitAnalysis {
  references: string[];
  rejection: string | null;
}

const EXTRACTION_VERSION = 2;
const MAX_FILE_BYTES = 200_000;
const MAX_PROGRAM_LENGTH = 24_000;
const DEFAULT_EXPORT = "defaultExport";
const RESOLVE_EXTENSIONS = [".ts", ".tsx", ".mts", ".js", ".jsx", ".mjs"];
const SOURCE_PATTERN = "**/*.{ts,tsx,mts,js,jsx,mjs}";
const IGNORED_PATTERNS = [
  "**/node_modules/**",
  "**/{dist,build,out,coverage,vendor,fixtures,__fixtures__,examples,example}/**",
  "**/{test,tests,__tests__,__mocks__,spec,e2e,bench,benchmark,benchmarks,docs,website,scripts}/**",
  "**/*.{test,spec,bench,stories,config}.*",
  "**/*.d.ts",
  "**/*.min.js",
];
const SAFE_GLOBALS = new Set([
  "Object",
  "Array",
  "String",
  "Number",
  "Boolean",
  "Math",
  "JSON",
  "Symbol",
  "BigInt",
  "RegExp",
  "Map",
  "Set",
  "WeakMap",
  "WeakSet",
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "ReferenceError",
  "EvalError",
  "URIError",
  "parseInt",
  "parseFloat",
  "isNaN",
  "isFinite",
  "encodeURIComponent",
  "decodeURIComponent",
  "encodeURI",
  "decodeURI",
  "undefined",
  "NaN",
  "Infinity",
  "arguments",
  "Reflect",
  "Proxy",
  "ArrayBuffer",
  "DataView",
  "Int8Array",
  "Uint8Array",
  "Uint8ClampedArray",
  "Int16Array",
  "Uint16Array",
  "Int32Array",
  "Uint32Array",
  "Float32Array",
  "Float64Array",
  "BigInt64Array",
  "BigUint64Array",
]);
const NAME_KINDS: [RegExp, CorpusParameter["kind"]][] = [
  [
    /^(fn|func|callback|cb|iteratee|predicate|comparator|compare|mapper|reducer|customizer|resolver|getter)$|(Fn|Callback)$/,
    "function",
  ],
  [
    /^(arr|array|arrays|list|items|values|collection|elements|entries|pairs)$|(Array|List)$/,
    "array",
  ],
  [
    /^(obj|object|options|opts|config|source|target|dict|record|props|params|settings|defaults)$/,
    "object",
  ],
  [
    /^(str|string|text|word|chars?|prefix|suffix|separator|sep|delimiter|path|url|html|title|label|format|template|name)$|(String|Text|Name)$/,
    "string",
  ],
  [
    /^(n|num|number|count|size|length|len|index|idx|start|end|min|max|lower|upper|step|precision|radix|limit|depth|amount|position|offset|width|height)$|(Count|Index|Size)$/,
    "number",
  ],
  [/^(is|has|should|can|allow)[A-Z]|^(flag|strict|deep|loose|enabled)$/, "boolean"],
];
const ANY_PARAMETER: CorpusParameter = { kind: "any", literals: [], isRest: false };

const getLoader = (path: string): Loader =>
  path.endsWith(".tsx")
    ? "tsx"
    : /\.m?ts$/.test(path)
      ? "ts"
      : path.endsWith(".jsx")
        ? "jsx"
        : "js";

const getParserPlugins = (path: string): ("typescript" | "jsx")[] => {
  const loader = getLoader(path);
  if (loader === "ts") return ["typescript"];
  return loader === "tsx" ? ["typescript", "jsx"] : ["jsx"];
};

const getExportName = (node: types.Identifier | types.StringLiteral): string =>
  types.isIdentifier(node) ? node.name : node.value;

const getRootIdentifier = (node: types.Node): types.Identifier | null => {
  if (types.isIdentifier(node)) return node;
  return types.isMemberExpression(node) ? getRootIdentifier(node.object) : null;
};

const isBuiltinMutation = (path: NodePath, node: types.Node): boolean => {
  const root = getRootIdentifier(node);
  return (
    root !== null &&
    root !== node &&
    SAFE_GLOBALS.has(root.name) &&
    !path.scope.getBinding(root.name)
  );
};

const getOrdinaryFunctionParent = (path: NodePath): NodePath | null =>
  path.findParent((parent) => parent.isFunction() && !parent.isArrowFunctionExpression());

/** Free names of one type-stripped unit; its own declarations count as free so closure keeps them. */
const getUnitAnalysis = (source: string): UnitAnalysis => {
  const references = new Set<string>();
  let rejection: string | null = null;
  const reject = (reason: string) => {
    rejection ??= reason;
  };
  const ast = parseSync(source, { babelrc: false, configFile: false, sourceType: "module" });
  if (!ast) return { references: [], rejection: "unparsed unit" };
  traverse(ast, {
    Import: () => reject("dynamic import"),
    MetaProperty: (inner) => {
      if (inner.node.meta.name === "import") reject("import.meta");
      else if (!getOrdinaryFunctionParent(inner)) reject("top-level new.target");
    },
    AwaitExpression: (inner) => {
      if (!inner.getFunctionParent()) reject("top-level await");
    },
    MemberExpression: (inner) => {
      if (inner.matchesPattern("Math.random")) reject("Math.random");
    },
    AssignmentExpression: (inner) => {
      if (isBuiltinMutation(inner, inner.node.left)) reject("builtin mutation");
    },
    CallExpression: (inner) => {
      const [firstArgument] = inner.node.arguments;
      if (
        firstArgument &&
        ["defineProperty", "defineProperties", "assign", "setPrototypeOf"].some((method) =>
          inner.get("callee").matchesPattern(`Object.${method}`),
        ) &&
        isBuiltinMutation(inner, firstArgument)
      )
        reject("builtin mutation");
    },
    ReferencedIdentifier: (inner) => {
      if (!inner.isIdentifier()) return;
      if (inner.node.name === "arguments" && !getOrdinaryFunctionParent(inner))
        reject("top-level arguments");
      const binding = inner.scope.getBinding(inner.node.name);
      if (!binding || binding.scope.path.isProgram()) references.add(inner.node.name);
    },
  });
  return { references: [...references], rejection };
};

const getLiteralText = (literal: types.TSLiteralType["literal"]): string | null => {
  if (types.isStringLiteral(literal)) return JSON.stringify(literal.value);
  if (types.isNumericLiteral(literal) || types.isBooleanLiteral(literal))
    return String(literal.value);
  if (types.isUnaryExpression(literal) && types.isNumericLiteral(literal.argument))
    return `(${literal.operator}${literal.argument.value})`;
  return null;
};

const getTypeParameter = (type: types.TSType | null): CorpusParameter => {
  const kind = (parameterKind: CorpusParameter["kind"], literals: string[] = []) => ({
    kind: parameterKind,
    literals,
    isRest: false,
  });
  if (!type) return ANY_PARAMETER;
  switch (type.type) {
    case "TSStringKeyword":
      return kind("string");
    case "TSNumberKeyword":
      return kind("number");
    case "TSBooleanKeyword":
      return kind("boolean");
    case "TSArrayType":
    case "TSTupleType":
      return kind("array");
    case "TSFunctionType":
      return kind("function");
    case "TSTypeLiteral":
    case "TSObjectKeyword":
      return kind("object");
    case "TSLiteralType": {
      const text = getLiteralText(type.literal);
      return text ? kind("any", [text]) : ANY_PARAMETER;
    }
    case "TSUnionType": {
      const members = type.types.filter(
        (member) => member.type !== "TSNullKeyword" && member.type !== "TSUndefinedKeyword",
      );
      const literals = members.flatMap((member) =>
        member.type === "TSLiteralType" ? [getLiteralText(member.literal)] : [],
      );
      if (literals.length === members.length && literals.every((text) => text !== null))
        return kind(
          "any",
          literals.filter((text) => text !== null),
        );
      return getTypeParameter(members[0] ?? null);
    }
    case "TSTypeReference": {
      const name = types.isIdentifier(type.typeName) ? type.typeName.name : "";
      if (["Array", "ReadonlyArray"].includes(name)) return kind("array");
      if (["Record", "Partial", "Readonly", "Required"].includes(name)) return kind("object");
      if (name === "Function") return kind("function");
      return ANY_PARAMETER;
    }
    default:
      return ANY_PARAMETER;
  }
};

const getAnnotation = (node: types.Node): types.TSType | null =>
  "typeAnnotation" in node && types.isTSTypeAnnotation(node.typeAnnotation)
    ? node.typeAnnotation.typeAnnotation
    : null;

const getDocumentedKind = (text: string | undefined): CorpusParameter["kind"] => {
  const type = text?.split("|")[0].trim() ?? "";
  if (/^string$/i.test(type)) return "string";
  if (/^number$/i.test(type)) return "number";
  if (/^boolean$/i.test(type)) return "boolean";
  if (/^array|\[\]$/i.test(type)) return "array";
  if (/^function$/i.test(type)) return "function";
  return /^object$/i.test(type) ? "object" : "any";
};

const getNamedKind = (name: string): CorpusParameter["kind"] =>
  NAME_KINDS.find(([pattern]) => pattern.test(name))?.[1] ?? "any";

const getDefaultKind = (node: types.Node): CorpusParameter["kind"] => {
  if (types.isStringLiteral(node) || types.isTemplateLiteral(node)) return "string";
  if (types.isNumericLiteral(node)) return "number";
  if (types.isBooleanLiteral(node)) return "boolean";
  if (types.isArrayExpression(node)) return "array";
  if (types.isObjectExpression(node)) return "object";
  return types.isFunction(node) ? "function" : "any";
};

const getParameter = (parameter: types.Node, documented: Map<string, string>): CorpusParameter => {
  if (types.isRestElement(parameter)) {
    const annotation = getAnnotation(parameter);
    const element = types.isTSArrayType(annotation) ? annotation.elementType : null;
    return { ...getTypeParameter(element), isRest: true };
  }
  if (types.isAssignmentPattern(parameter)) {
    const annotated = getParameter(parameter.left, documented);
    return annotated.kind === "any" && annotated.literals.length === 0
      ? { ...annotated, kind: getDefaultKind(parameter.right) }
      : annotated;
  }
  if (types.isObjectPattern(parameter)) return { ...ANY_PARAMETER, kind: "object" };
  if (types.isArrayPattern(parameter)) return { ...ANY_PARAMETER, kind: "array" };
  const typed = getTypeParameter(getAnnotation(parameter));
  if (typed.kind !== "any" || typed.literals.length > 0 || !types.isIdentifier(parameter))
    return typed;
  const documentedKind = getDocumentedKind(documented.get(parameter.name));
  return {
    ...ANY_PARAMETER,
    kind: documentedKind === "any" ? getNamedKind(parameter.name) : documentedKind,
  };
};

const getDocumentedParameters = (nodes: types.Node[]): Map<string, string> => {
  const documented = new Map<string, string>();
  const comment = nodes
    .flatMap((node) => node.leadingComments ?? [])
    .findLast((candidate) => candidate.type === "CommentBlock" && candidate.value.startsWith("*"));
  for (const match of comment?.value.matchAll(/@param\s+\{([^}]+)\}\s+\[?([\w$]+)/g) ?? [])
    documented.set(match[2], match[1]);
  return documented;
};

const getTargetParameters = (
  node: types.Function,
  commentNodes: types.Node[],
): CorpusParameter[] => {
  const documented = getDocumentedParameters(commentNodes);
  return node.params
    .filter((parameter) => !(types.isIdentifier(parameter) && parameter.name === "this"))
    .map((parameter) => getParameter(parameter, documented));
};

const isTargetFunction = (node: types.Node | null | undefined): node is types.Function =>
  types.isFunction(node) && !node.async && !node.generator;

const stripTypes = (source: string, loader: Loader): string | null => {
  try {
    return transformSync(source, { loader }).code;
  } catch {
    return null;
  }
};

const addUnit = (module: CorpusModule, names: string[], source: string): void => {
  const stripped = stripTypes(source, getLoader(module.path));
  const analysis = stripped === null ? null : getUnitAnalysis(stripped);
  const unit: CorpusUnit = {
    names,
    source: stripped ?? "",
    references: analysis?.references ?? [],
    rejection: analysis ? analysis.rejection : "type stripping",
  };
  module.units.push(unit);
  for (const name of names) if (!module.unitByName.has(name)) module.unitByName.set(name, unit);
};

const addDeclaration = (
  module: CorpusModule,
  node: types.Node,
  code: string,
  commentNodes: types.Node[],
): string[] => {
  const source = code.slice(node.start ?? 0, node.end ?? 0);
  if (types.isFunctionDeclaration(node) && node.id) {
    addUnit(module, [node.id.name], source);
    if (isTargetFunction(node))
      module.targets.push({
        name: node.id.name,
        parameters: getTargetParameters(node, [...commentNodes, node]),
      });
    return [node.id.name];
  }
  if (
    (types.isClassDeclaration(node) || types.isTSEnumDeclaration(node)) &&
    node.id &&
    !node.declare
  ) {
    addUnit(module, [node.id.name], source);
    return [node.id.name];
  }
  if (!types.isVariableDeclaration(node) || node.declare) return [];
  const names = Object.keys(types.getBindingIdentifiers(node));
  addUnit(module, names, source);
  const [declarator] = node.declarations;
  if (
    node.declarations.length === 1 &&
    node.kind === "const" &&
    types.isIdentifier(declarator.id) &&
    isTargetFunction(declarator.init)
  )
    module.targets.push({
      name: declarator.id.name,
      parameters: getTargetParameters(declarator.init, [...commentNodes, node]),
    });
  return names;
};

const addImport = (module: CorpusModule, node: types.ImportDeclaration): void => {
  if (node.importKind === "type" || node.importKind === "typeof") return;
  for (const specifier of node.specifiers) {
    if (types.isImportSpecifier(specifier) && specifier.importKind === "type") continue;
    const imported = types.isImportSpecifier(specifier)
      ? getExportName(specifier.imported)
      : types.isImportDefaultSpecifier(specifier)
        ? "default"
        : "*";
    module.imports.set(specifier.local.name, { imported, specifier: node.source.value });
  }
};

const addNamedExport = (
  module: CorpusModule,
  node: types.ExportNamedDeclaration,
  code: string,
): void => {
  if (node.exportKind === "type") return;
  if (node.declaration) {
    for (const name of addDeclaration(module, node.declaration, code, [node]))
      module.exports.set(name, name);
    return;
  }
  for (const specifier of node.specifiers) {
    if (types.isExportSpecifier(specifier) && specifier.exportKind === "type") continue;
    const exported = getExportName(specifier.exported);
    const local = types.isExportSpecifier(specifier) ? specifier.local.name : "*";
    if (node.source)
      module.reexports.set(exported, { imported: local, specifier: node.source.value });
    else module.exports.set(exported, local);
  }
};

const addDefaultExport = (
  module: CorpusModule,
  node: types.ExportDefaultDeclaration,
  code: string,
): void => {
  const { declaration } = node;
  if (types.isIdentifier(declaration)) {
    module.exports.set("default", declaration.name);
    return;
  }
  if (
    (types.isFunctionDeclaration(declaration) || types.isClassDeclaration(declaration)) &&
    declaration.id
  ) {
    const [name] = addDeclaration(module, declaration, code, [node]);
    module.exports.set("default", name);
    return;
  }
  if (
    !types.isExpression(declaration) &&
    !types.isFunctionDeclaration(declaration) &&
    !types.isClassDeclaration(declaration)
  )
    return;
  const expression = code.slice(declaration.start ?? 0, declaration.end ?? 0);
  addUnit(module, [DEFAULT_EXPORT], `const ${DEFAULT_EXPORT} = ${expression};`);
  module.exports.set("default", DEFAULT_EXPORT);
  if (isTargetFunction(declaration))
    module.targets.push({
      name: DEFAULT_EXPORT,
      parameters: getTargetParameters(declaration, [node]),
    });
};

const addStatement = (module: CorpusModule, node: types.Statement, code: string): void => {
  if (types.isImportDeclaration(node)) addImport(module, node);
  else if (types.isExportAllDeclaration(node)) {
    if (node.exportKind !== "type") module.starExports.push(node.source.value);
  } else if (types.isExportNamedDeclaration(node)) addNamedExport(module, node, code);
  else if (types.isExportDefaultDeclaration(node)) addDefaultExport(module, node, code);
  else addDeclaration(module, node, code, []);
};

const parseCorpusModule = ({ path, code }: CorpusSourceFile): CorpusModule | null => {
  const module: CorpusModule = {
    path,
    units: [],
    unitByName: new Map(),
    imports: new Map(),
    exports: new Map(),
    reexports: new Map(),
    starExports: [],
    targets: [],
  };
  try {
    const ast = parseSync(code, {
      filename: path,
      babelrc: false,
      configFile: false,
      sourceType: "module",
      parserOpts: { plugins: getParserPlugins(path) },
    });
    if (!ast) return null;
    for (const statement of ast.program.body) addStatement(module, statement, code);
  } catch {
    return null;
  }
  return module;
};

const resolveSpecifier = (
  modules: Map<string, CorpusModule>,
  fromPath: string,
  specifier: string,
): CorpusModule | null => {
  if (!specifier.startsWith(".")) return null;
  const base = join(dirname(fromPath), specifier);
  const stem = base.replace(/\.(m?js|jsx)$/, "");
  const candidates = [
    base,
    ...RESOLVE_EXTENSIONS.map((extension) => stem + extension),
    ...RESOLVE_EXTENSIONS.map((extension) => join(base, `index${extension}`)),
  ];
  for (const candidate of candidates) {
    const module = modules.get(candidate);
    if (module) return module;
  }
  return null;
};

const resolveExport = (
  modules: Map<string, CorpusModule>,
  module: CorpusModule,
  exported: string,
  visited: Set<string>,
): CorpusBinding | null => {
  const key = `${module.path}#${exported}`;
  if (visited.has(key)) return null;
  visited.add(key);
  const local = module.exports.get(exported);
  if (local !== undefined) return resolveLocal(modules, module, local, visited);
  const reexport = module.reexports.get(exported);
  if (reexport) return resolveImport(modules, module, reexport, visited);
  if (exported === "default") return null;
  for (const specifier of module.starExports) {
    const target = resolveSpecifier(modules, module.path, specifier);
    const found = target && resolveExport(modules, target, exported, visited);
    if (found) return found;
  }
  return null;
};

const resolveImport = (
  modules: Map<string, CorpusModule>,
  module: CorpusModule,
  entry: CorpusImport,
  visited: Set<string>,
): CorpusBinding | null => {
  if (entry.imported === "*") return null;
  const target = resolveSpecifier(modules, module.path, entry.specifier);
  return target && resolveExport(modules, target, entry.imported, visited);
};

const resolveLocal = (
  modules: Map<string, CorpusModule>,
  module: CorpusModule,
  name: string,
  visited: Set<string>,
): CorpusBinding | null => {
  if (module.unitByName.has(name)) return { module, name };
  const entry = module.imports.get(name);
  return entry ? resolveImport(modules, module, entry, visited) : null;
};

const getImportRejection = (entry: CorpusImport): string => {
  if (entry.imported === "*") return "namespace import";
  return entry.specifier.startsWith(".") ? "unresolved import" : "package import";
};

const getClosure = (
  modules: Map<string, CorpusModule>,
  target: CorpusBinding,
): CorpusClosure | string => {
  const closure: CorpusClosure = { units: new Map(), aliases: new Map() };
  const pending: [CorpusModule, CorpusUnit][] = [];
  const include = (module: CorpusModule, unit: CorpusUnit | undefined) => {
    if (!unit) return;
    const units = closure.units.get(module) ?? new Set();
    closure.units.set(module, units);
    if (units.has(unit)) return;
    units.add(unit);
    pending.push([module, unit]);
  };
  include(target.module, target.module.unitByName.get(target.name));
  for (let next = pending.pop(); next; next = pending.pop()) {
    const [module, unit] = next;
    if (unit.rejection) return unit.rejection;
    for (const name of unit.references) {
      if (module.unitByName.has(name)) {
        include(module, module.unitByName.get(name));
        continue;
      }
      const entry = module.imports.get(name);
      if (!entry) {
        if (SAFE_GLOBALS.has(name)) continue;
        return `global ${name}`;
      }
      const binding = resolveImport(modules, module, entry, new Set());
      if (!binding) return getImportRejection(entry);
      const aliases = closure.aliases.get(module) ?? new Map<string, CorpusBinding>();
      closure.aliases.set(module, aliases.set(name, binding));
      include(binding.module, binding.module.unitByName.get(binding.name));
    }
  }
  return closure;
};

const getModuleOrder = (closure: CorpusClosure, root: CorpusModule): CorpusModule[] | null => {
  const order: CorpusModule[] = [];
  const visiting = new Set<CorpusModule>();
  const visit = (module: CorpusModule): boolean => {
    if (order.includes(module)) return true;
    if (visiting.has(module)) return false;
    visiting.add(module);
    for (const binding of closure.aliases.get(module)?.values() ?? [])
      if (binding.module !== module && !visit(binding.module)) return false;
    visiting.delete(module);
    order.push(module);
    return true;
  };
  return visit(root) ? order : null;
};

const emitClosure = (closure: CorpusClosure, target: CorpusBinding): string | null => {
  const order = getModuleOrder(closure, target.module);
  if (!order) return null;
  const getModuleName = (module: CorpusModule) => `corpusModule${order.indexOf(module)}`;
  const modules = order.map((module) => {
    const units = closure.units.get(module) ?? new Set();
    const aliases = [...(closure.aliases.get(module) ?? [])].map(
      ([local, binding]) => `const ${local} = ${getModuleName(binding.module)}.${binding.name};\n`,
    );
    const sources = module.units.filter((unit) => units.has(unit)).map((unit) => unit.source);
    const names = [...units].flatMap((unit) => unit.names);
    return `const ${getModuleName(module)} = (() => {\n${[...aliases, ...sources].join("")}return { ${names.join(", ")} };\n})();\n`;
  });
  return `${modules.join("")}const corpusTarget = ${getModuleName(target.module)}.${target.name};\n`;
};

export const extractCorpusFunctions = (
  files: CorpusSourceFile[],
  originPrefix: string,
): CorpusExtraction => {
  const modules = new Map<string, CorpusModule>();
  const rejections: Record<string, number> = {};
  const addRejection = (reason: string) => {
    rejections[reason] = (rejections[reason] ?? 0) + 1;
  };
  for (const file of files) {
    const module = parseCorpusModule(file);
    if (module) modules.set(file.path, module);
    else addRejection("unparsed file");
  }
  const functions = new Map<string, CorpusFunction>();
  let targetCount = 0;
  for (const module of modules.values())
    for (const target of module.targets) {
      targetCount++;
      const closure = getClosure(modules, { module, name: target.name });
      if (typeof closure === "string") {
        addRejection(closure);
        continue;
      }
      const source = emitClosure(closure, { module, name: target.name });
      if (!source) addRejection("import cycle");
      else if (source.length > MAX_PROGRAM_LENGTH) addRejection("too large");
      else if (functions.has(source)) addRejection("duplicate");
      else
        functions.set(source, {
          origin: `${originPrefix}:${module.path}#${target.name}`,
          source,
          parameters: target.parameters,
        });
    }
  return {
    files: files.length,
    targets: targetCount,
    functions: [...functions.values()],
    rejections,
  };
};

const readRepositoryFiles = (directory: string): CorpusSourceFile[] =>
  globSync(SOURCE_PATTERN, { cwd: directory, ignore: IGNORED_PATTERNS })
    .sort()
    .filter((path) => statSync(join(directory, path)).size <= MAX_FILE_BYTES)
    .map((path) => ({ path, code: readFileSync(join(directory, path), "utf8") }));

/** Checks out and extracts one repository, caching the extraction beside the checkout. */
export const extractRepositoryFunctions = (
  corpusDirectory: string,
  repository: CorpusRepository,
): CorpusExtraction | null => {
  const cacheDirectory = join(corpusDirectory, "extractions");
  const cachePath = join(
    cacheDirectory,
    `${getCheckoutDirectory("", repository)}.v${EXTRACTION_VERSION}.json`,
  );
  if (existsSync(cachePath)) return JSON.parse(readFileSync(cachePath, "utf8"));
  const checkout = ensureCorpusCheckout(corpusDirectory, repository);
  if (!checkout) return null;
  const extraction = extractCorpusFunctions(
    readRepositoryFiles(checkout),
    `${repository.repository}@${repository.revision.slice(0, 7)}`,
  );
  mkdirSync(cacheDirectory, { recursive: true });
  writeFileSync(cachePath, JSON.stringify(extraction));
  return extraction;
};
