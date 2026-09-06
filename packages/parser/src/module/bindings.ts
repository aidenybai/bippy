import type {
  BindingPattern,
  CallExpression,
  Expression,
  ModuleExportName,
  Program,
  Span,
  Statement,
  VariableDeclarator,
} from "@oxc-project/types";
import { getMemberChain, isStringLiteral, unwrapExpression } from "./ast.js";
import {
  type Binding,
  DEFAULT_EXPORT_NAME,
  type ModuleExports,
  NAMESPACE_IMPORT_NAME,
  type NamedExport,
} from "./types.js";

export interface ModuleTables {
  bindings: Map<string, Binding>;
  exports: ModuleExports;
}

const getModuleExportName = (name: ModuleExportName): string =>
  name.type === "Literal" ? name.value : name.name;

const REQUIRE_INTEROP_HELPERS = new Set([
  "_interopRequireDefault",
  "_interopRequireWildcard",
  "__importDefault",
  "__importStar",
  "__toESM",
]);

/**
 * Recognizes `require("m")`, `_interopRequireDefault(require("m"))` and
 * `require("m").default`, returning the module request and the imported name.
 */
const getRequireTarget = (
  expression: Expression,
): { moduleRequest: string; importedName: string } | null => {
  const unwrapped = unwrapExpression(expression);
  if (unwrapped.type === "MemberExpression" && !unwrapped.computed) {
    const inner = getRequireTarget(unwrapped.object);
    if (!inner || inner.importedName !== NAMESPACE_IMPORT_NAME) return null;
    return { moduleRequest: inner.moduleRequest, importedName: unwrapped.property.name };
  }
  if (unwrapped.type !== "CallExpression") return null;
  const callee = unwrapExpression(unwrapped.callee);
  if (callee.type === "Identifier" && callee.name === "require") {
    const [source] = unwrapped.arguments;
    if (source && isStringLiteral(source)) {
      return { moduleRequest: source.value, importedName: NAMESPACE_IMPORT_NAME };
    }
    return null;
  }
  const calleeChain = getMemberChain(callee);
  const helperName = calleeChain?.at(-1);
  if (helperName && REQUIRE_INTEROP_HELPERS.has(helperName)) {
    const [argument] = unwrapped.arguments;
    if (argument && argument.type !== "SpreadElement") return getRequireTarget(argument);
  }
  return null;
};

const collectPatternBindings = (
  pattern: BindingPattern,
  declarator: VariableDeclarator,
  bindings: Map<string, Binding>,
): void => {
  switch (pattern.type) {
    case "Identifier":
      bindings.set(pattern.name, {
        kind: "declaration",
        localName: pattern.name,
        node: declarator,
        span: { start: pattern.start, end: pattern.end },
      });
      return;
    case "AssignmentPattern":
      collectPatternBindings(pattern.left, declarator, bindings);
      return;
    case "ObjectPattern":
      for (const property of pattern.properties) {
        collectPatternBindings(
          property.type === "RestElement" ? property.argument : property.value,
          declarator,
          bindings,
        );
      }
      return;
    case "ArrayPattern":
      for (const element of pattern.elements) {
        if (!element) continue;
        collectPatternBindings(
          element.type === "RestElement" ? element.argument : element,
          declarator,
          bindings,
        );
      }
      return;
  }
};

const collectRequireBindings = (
  declarator: VariableDeclarator,
  bindings: Map<string, Binding>,
): boolean => {
  if (!declarator.init) return false;
  const target = getRequireTarget(declarator.init);
  if (!target) return false;
  const span: Span = { start: declarator.start, end: declarator.end };
  if (declarator.id.type === "Identifier") {
    bindings.set(declarator.id.name, {
      kind: "import",
      localName: declarator.id.name,
      moduleRequest: target.moduleRequest,
      importedName: target.importedName,
      isTypeOnly: false,
      span,
    });
    return true;
  }
  if (declarator.id.type === "ObjectPattern" && target.importedName === NAMESPACE_IMPORT_NAME) {
    for (const property of declarator.id.properties) {
      if (property.type === "RestElement") continue;
      if (property.key.type !== "Identifier" || property.value.type !== "Identifier") continue;
      bindings.set(property.value.name, {
        kind: "import",
        localName: property.value.name,
        moduleRequest: target.moduleRequest,
        importedName: property.key.name,
        isTypeOnly: false,
        span,
      });
    }
    return true;
  }
  return false;
};

const isExportsObject = (expression: Expression): boolean => {
  const chain = getMemberChain(expression);
  return chain !== null && (chain.join(".") === "exports" || chain.join(".") === "module.exports");
};

const getExportsMemberName = (expression: Expression): string | null => {
  const unwrapped = unwrapExpression(expression);
  if (unwrapped.type !== "MemberExpression") return null;
  if (!isExportsObject(unwrapped.object)) return null;
  if (!unwrapped.computed && unwrapped.property.type === "Identifier") {
    return unwrapped.property.name;
  }
  if (unwrapped.computed && isStringLiteral(unwrapped.property)) return unwrapped.property.value;
  return null;
};

const setValueOrLocalExport = (
  exports: ModuleExports,
  exportedName: string,
  value: Expression,
  span: Span,
): void => {
  const unwrapped = unwrapExpression(value);
  exports.named.set(
    exportedName,
    unwrapped.type === "Identifier"
      ? { kind: "local", exportedName, localName: unwrapped.name, span }
      : { kind: "value", exportedName, node: unwrapped, span },
  );
};

const collectCommonJsAssignment = (expression: Expression, exports: ModuleExports): void => {
  if (expression.type !== "AssignmentExpression" || expression.operator !== "=") return;
  const target = expression.left;
  if (target.type !== "MemberExpression") return;
  const span: Span = { start: expression.start, end: expression.end };
  const memberName = getExportsMemberName(target);
  if (memberName !== null) {
    exports.isCommonJs = true;
    setValueOrLocalExport(exports, memberName, expression.right, span);
    return;
  }
  if (!isExportsObject(target)) return;
  exports.isCommonJs = true;
  const value = unwrapExpression(expression.right);
  if (value.type === "ObjectExpression") {
    for (const property of value.properties) {
      if (property.type !== "Property" || property.computed) continue;
      if (property.key.type !== "Identifier") continue;
      setValueOrLocalExport(exports, property.key.name, property.value, span);
    }
    return;
  }
  const requireTarget = getRequireTarget(value);
  if (requireTarget && requireTarget.importedName === NAMESPACE_IMPORT_NAME) {
    exports.stars.push({ kind: "star", moduleRequest: requireTarget.moduleRequest, span });
    return;
  }
  setValueOrLocalExport(exports, DEFAULT_EXPORT_NAME, value, span);
};

const getDefinePropertyGetter = (call: CallExpression): NamedExport | null => {
  const callee = getMemberChain(call.callee);
  if (!callee || callee.join(".") !== "Object.defineProperty") return null;
  const [target, name, descriptor] = call.arguments;
  if (!target || target.type === "SpreadElement" || !isExportsObject(target)) return null;
  if (!name || !isStringLiteral(name)) return null;
  if (!descriptor || descriptor.type !== "ObjectExpression") return null;
  const span: Span = { start: call.start, end: call.end };
  for (const property of descriptor.properties) {
    if (property.type !== "Property" || property.key.type !== "Identifier") continue;
    if (property.key.name !== "get") continue;
    const getter = unwrapExpression(property.value);
    if (getter.type !== "FunctionExpression" && getter.type !== "ArrowFunctionExpression") {
      continue;
    }
    if (getter.body === null) continue;
    let returned: Expression | null = null;
    if (getter.body.type === "BlockStatement") {
      for (const statement of getter.body.body) {
        if (statement.type === "ReturnStatement") returned = statement.argument;
      }
    } else {
      returned = getter.body;
    }
    if (!returned) continue;
    const unwrapped = unwrapExpression(returned);
    return unwrapped.type === "Identifier"
      ? { kind: "local", exportedName: name.value, localName: unwrapped.name, span }
      : { kind: "value", exportedName: name.value, node: unwrapped, span };
  }
  return null;
};

const collectCommonJsCall = (
  call: CallExpression,
  exports: ModuleExports,
  bindings: Map<string, Binding>,
): void => {
  const definedExport = getDefinePropertyGetter(call);
  if (definedExport) {
    exports.isCommonJs = true;
    exports.named.set(definedExport.exportedName, definedExport);
    return;
  }
  const calleeChain = getMemberChain(call.callee);
  if (calleeChain?.at(-1) === "__exportStar" || calleeChain?.at(-1) === "__reExport") {
    const [source] = call.arguments;
    if (!source || source.type === "SpreadElement") return;
    const requireTarget = getRequireTarget(source);
    const span: Span = { start: call.start, end: call.end };
    if (requireTarget) {
      exports.isCommonJs = true;
      exports.stars.push({ kind: "star", moduleRequest: requireTarget.moduleRequest, span });
      return;
    }
    const unwrapped = unwrapExpression(source);
    if (unwrapped.type === "Identifier") {
      const binding = bindings.get(unwrapped.name);
      if (binding?.kind === "import" && binding.importedName === NAMESPACE_IMPORT_NAME) {
        exports.isCommonJs = true;
        exports.stars.push({ kind: "star", moduleRequest: binding.moduleRequest, span });
      }
    }
  }
};

const collectEsmExport = (
  statement: Statement,
  exports: ModuleExports,
  bindings: Map<string, Binding>,
): void => {
  const span: Span = { start: statement.start, end: statement.end };
  switch (statement.type) {
    case "ExportAllDeclaration": {
      if (statement.exportKind === "type") return;
      if (statement.exported) {
        const exportedName = getModuleExportName(statement.exported);
        exports.named.set(exportedName, {
          kind: "reexport",
          exportedName,
          moduleRequest: statement.source.value,
          importedName: NAMESPACE_IMPORT_NAME,
          span,
        });
      } else {
        exports.stars.push({ kind: "star", moduleRequest: statement.source.value, span });
      }
      return;
    }
    case "ExportDefaultDeclaration": {
      const declaration = statement.declaration;
      if (declaration.type === "TSInterfaceDeclaration") return;
      if (
        (declaration.type === "FunctionDeclaration" || declaration.type === "ClassDeclaration") &&
        declaration.id
      ) {
        bindings.set(declaration.id.name, {
          kind: "declaration",
          localName: declaration.id.name,
          node: declaration,
          span,
        });
        exports.named.set(DEFAULT_EXPORT_NAME, {
          kind: "local",
          exportedName: DEFAULT_EXPORT_NAME,
          localName: declaration.id.name,
          span,
        });
        return;
      }
      if (declaration.type === "FunctionDeclaration" || declaration.type === "ClassDeclaration") {
        exports.named.set(DEFAULT_EXPORT_NAME, {
          kind: "value",
          exportedName: DEFAULT_EXPORT_NAME,
          node: declaration,
          span,
        });
        return;
      }
      setValueOrLocalExport(exports, DEFAULT_EXPORT_NAME, declaration, span);
      return;
    }
    case "ExportNamedDeclaration": {
      if (statement.exportKind === "type") return;
      if (statement.declaration) {
        collectDeclaration(statement.declaration, bindings);
        for (const localName of getDeclaredNames(statement.declaration)) {
          exports.named.set(localName, { kind: "local", exportedName: localName, localName, span });
        }
        return;
      }
      for (const specifier of statement.specifiers) {
        if (specifier.exportKind === "type") continue;
        const exportedName = getModuleExportName(specifier.exported);
        const localName = getModuleExportName(specifier.local);
        exports.named.set(
          exportedName,
          statement.source
            ? {
                kind: "reexport",
                exportedName,
                moduleRequest: statement.source.value,
                importedName: localName,
                span,
              }
            : { kind: "local", exportedName, localName, span },
        );
      }
      return;
    }
  }
};

const getDeclaredNames = (declaration: Statement): string[] => {
  switch (declaration.type) {
    case "FunctionDeclaration":
    case "ClassDeclaration":
      return declaration.id ? [declaration.id.name] : [];
    case "TSEnumDeclaration":
      return [declaration.id.name];
    case "VariableDeclaration": {
      const names = new Map<string, Binding>();
      for (const declarator of declaration.declarations) {
        collectPatternBindings(declarator.id, declarator, names);
      }
      return [...names.keys()];
    }
    default:
      return [];
  }
};

const collectDeclaration = (statement: Statement, bindings: Map<string, Binding>): void => {
  switch (statement.type) {
    case "FunctionDeclaration":
    case "ClassDeclaration":
      if (statement.id) {
        bindings.set(statement.id.name, {
          kind: "declaration",
          localName: statement.id.name,
          node: statement,
          span: { start: statement.start, end: statement.end },
        });
      }
      return;
    case "VariableDeclaration":
      for (const declarator of statement.declarations) {
        if (collectRequireBindings(declarator, bindings)) continue;
        collectPatternBindings(declarator.id, declarator, bindings);
      }
      return;
    case "TSEnumDeclaration":
      bindings.set(statement.id.name, {
        kind: "declaration",
        localName: statement.id.name,
        node: statement,
        span: { start: statement.start, end: statement.end },
      });
      return;
  }
};

const collectImport = (statement: Statement, bindings: Map<string, Binding>): void => {
  if (statement.type !== "ImportDeclaration") return;
  const isTypeOnlyDeclaration = statement.importKind === "type";
  for (const specifier of statement.specifiers) {
    const span: Span = { start: specifier.start, end: specifier.end };
    switch (specifier.type) {
      case "ImportDefaultSpecifier":
        bindings.set(specifier.local.name, {
          kind: "import",
          localName: specifier.local.name,
          moduleRequest: statement.source.value,
          importedName: DEFAULT_EXPORT_NAME,
          isTypeOnly: isTypeOnlyDeclaration,
          span,
        });
        break;
      case "ImportNamespaceSpecifier":
        bindings.set(specifier.local.name, {
          kind: "import",
          localName: specifier.local.name,
          moduleRequest: statement.source.value,
          importedName: NAMESPACE_IMPORT_NAME,
          isTypeOnly: isTypeOnlyDeclaration,
          span,
        });
        break;
      case "ImportSpecifier":
        bindings.set(specifier.local.name, {
          kind: "import",
          localName: specifier.local.name,
          moduleRequest: statement.source.value,
          importedName: getModuleExportName(specifier.imported),
          isTypeOnly: isTypeOnlyDeclaration || specifier.importKind === "type",
          span,
        });
        break;
    }
  }
};

/**
 * Collects the top-level bindings and the export table of a module. Both ESM
 * and the CommonJS shapes emitted by Babel, TypeScript and esbuild are
 * recognized so compiled dependencies can be linked as well.
 */
export const collectModuleTables = (program: Program): ModuleTables => {
  const bindings = new Map<string, Binding>();
  const exports: ModuleExports = { named: new Map(), stars: [], isCommonJs: false };

  for (const statement of program.body) {
    if ("directive" in statement) continue;
    collectImport(statement, bindings);
    collectDeclaration(statement, bindings);
    collectEsmExport(statement, exports, bindings);
    if (statement.type === "ExpressionStatement") {
      const expression = unwrapExpression(statement.expression);
      if (expression.type === "SequenceExpression") {
        for (const inner of expression.expressions) collectCommonJsAssignment(inner, exports);
      } else if (expression.type === "CallExpression") {
        collectCommonJsCall(expression, exports, bindings);
      } else {
        collectCommonJsAssignment(expression, exports);
      }
    }
  }

  return { bindings, exports };
};
