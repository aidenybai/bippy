import type {
  BindingPattern,
  CallExpression,
  ExportDefaultDeclaration,
  ExportNamedDeclaration,
  Expression,
  ImportDeclaration,
  ModuleExportName,
  Node,
  ObjectExpression,
  PropertyKey,
  Statement,
  VariableDeclaration,
} from "oxc-parser";
import { forEachChildNode, isFunctionLikeNode } from "../parse/ast-walk.js";
import type {
  ExportEntry,
  ImportBinding,
  ImportedName,
  MemberAssignment,
  ModuleRecord,
  ParsedSourceFile,
  ReExportAll,
  TopLevelBinding,
} from "../types.js";

const getModuleExportName = (name: ModuleExportName): string =>
  name.type === "Literal" ? name.value : name.name;

const collectPatternNames = (pattern: BindingPattern, names: string[]): void => {
  switch (pattern.type) {
    case "Identifier":
      names.push(pattern.name);
      return;
    case "ObjectPattern":
      for (const property of pattern.properties) {
        if (property.type === "RestElement") collectPatternNames(property.argument, names);
        else collectPatternNames(property.value, names);
      }
      return;
    case "ArrayPattern":
      for (const element of pattern.elements) {
        if (!element) continue;
        if (element.type === "RestElement") collectPatternNames(element.argument, names);
        else collectPatternNames(element, names);
      }
      return;
    case "AssignmentPattern":
      collectPatternNames(pattern.left, names);
      return;
  }
};

const collectVariableBindings = (
  declaration: VariableDeclaration,
  bindings: Map<string, TopLevelBinding>,
): string[] => {
  const declaredNames: string[] = [];
  for (const declarator of declaration.declarations) {
    if (declarator.id.type === "Identifier") {
      bindings.set(declarator.id.name, {
        kind: "variable",
        name: declarator.id.name,
        init: declarator.init,
        declarationKind: declaration.kind,
        span: declarator,
      });
      declaredNames.push(declarator.id.name);
      continue;
    }
    const names: string[] = [];
    collectPatternNames(declarator.id, names);
    for (const name of names) {
      bindings.set(name, {
        kind: "destructured",
        name,
        pattern: declarator.id,
        init: declarator.init,
        span: declarator,
      });
      declaredNames.push(name);
    }
  }
  return declaredNames;
};

const collectImports = (declaration: ImportDeclaration, imports: ImportBinding[]): void => {
  const isTypeOnlyDeclaration = declaration.importKind === "type";
  for (const specifier of declaration.specifiers) {
    let imported: ImportedName;
    let isTypeOnly = isTypeOnlyDeclaration;
    switch (specifier.type) {
      case "ImportDefaultSpecifier":
        imported = { kind: "default" };
        break;
      case "ImportNamespaceSpecifier":
        imported = { kind: "namespace" };
        break;
      case "ImportSpecifier":
        imported = { kind: "named", name: getModuleExportName(specifier.imported) };
        isTypeOnly = isTypeOnly || specifier.importKind === "type";
        break;
    }
    imports.push({
      localName: specifier.local.name,
      imported,
      specifier: declaration.source.value,
      isTypeOnly,
      span: specifier,
    });
  }
};

const collectNamedExports = (
  declaration: ExportNamedDeclaration,
  bindings: Map<string, TopLevelBinding>,
  exports: ExportEntry[],
): void => {
  if (declaration.exportKind === "type") return;
  if (declaration.declaration) {
    const declared = declaration.declaration;
    if (declared.type === "VariableDeclaration") {
      for (const name of collectVariableBindings(declared, bindings)) {
        exports.push({ kind: "local", exportedName: name, localName: name });
      }
    } else if (declared.type === "FunctionDeclaration" && declared.id) {
      bindings.set(declared.id.name, {
        kind: "function",
        name: declared.id.name,
        node: declared,
        span: declared,
      });
      exports.push({ kind: "local", exportedName: declared.id.name, localName: declared.id.name });
    } else if (declared.type === "ClassDeclaration" && declared.id) {
      bindings.set(declared.id.name, {
        kind: "class",
        name: declared.id.name,
        node: declared,
        span: declared,
      });
      exports.push({ kind: "local", exportedName: declared.id.name, localName: declared.id.name });
    }
    return;
  }
  for (const specifier of declaration.specifiers) {
    if (specifier.exportKind === "type") continue;
    const exportedName = getModuleExportName(specifier.exported);
    const localName = getModuleExportName(specifier.local);
    if (declaration.source) {
      exports.push({
        kind: "re-export",
        exportedName,
        imported:
          localName === "default" ? { kind: "default" } : { kind: "named", name: localName },
        specifier: declaration.source.value,
      });
    } else {
      exports.push({ kind: "local", exportedName, localName });
    }
  }
};

const collectDefaultExport = (
  declaration: ExportDefaultDeclaration,
  bindings: Map<string, TopLevelBinding>,
  exports: ExportEntry[],
): void => {
  const declared = declaration.declaration;
  if (declared.type === "TSInterfaceDeclaration") return;
  if (declared.type === "FunctionDeclaration" && declared.id) {
    bindings.set(declared.id.name, {
      kind: "function",
      name: declared.id.name,
      node: declared,
      span: declared,
    });
    exports.push({ kind: "local", exportedName: "default", localName: declared.id.name });
    return;
  }
  if (declared.type === "ClassDeclaration" && declared.id) {
    bindings.set(declared.id.name, {
      kind: "class",
      name: declared.id.name,
      node: declared,
      span: declared,
    });
    exports.push({ kind: "local", exportedName: "default", localName: declared.id.name });
    return;
  }
  if (declared.type === "TSDeclareFunction" || declared.type === "TSEmptyBodyFunctionExpression") {
    return;
  }
  exports.push({ kind: "expression", exportedName: "default", expression: declared });
};

const collectStatement = (
  statement: Statement,
  imports: ImportBinding[],
  exports: ExportEntry[],
  bindings: Map<string, TopLevelBinding>,
): void => {
  switch (statement.type) {
    case "ImportDeclaration":
      collectImports(statement, imports);
      return;
    case "ExportNamedDeclaration":
      collectNamedExports(statement, bindings, exports);
      return;
    case "ExportDefaultDeclaration":
      collectDefaultExport(statement, bindings, exports);
      return;
    case "ExportAllDeclaration":
      if (statement.exportKind === "type") return;
      if (statement.exported) {
        exports.push({
          kind: "re-export",
          exportedName: getModuleExportName(statement.exported),
          imported: { kind: "namespace" },
          specifier: statement.source.value,
        });
      } else {
        exports.push({ kind: "re-export-all", specifier: statement.source.value });
      }
      return;
    case "VariableDeclaration":
      if (!statement.declare) collectVariableBindings(statement, bindings);
      return;
    case "FunctionDeclaration":
      if (statement.id) {
        bindings.set(statement.id.name, {
          kind: "function",
          name: statement.id.name,
          node: statement,
          span: statement,
        });
      }
      return;
    case "ClassDeclaration":
      if (statement.id) {
        bindings.set(statement.id.name, {
          kind: "class",
          name: statement.id.name,
          node: statement,
          span: statement,
        });
      }
      return;
    default:
      return;
  }
};

const collectMemberAssignment = (
  statement: Statement,
  memberAssignments: MemberAssignment[],
  condition: Expression | null = null,
): void => {
  if (statement.type === "IfStatement" && !statement.alternate && condition === null) {
    const body =
      statement.consequent.type === "BlockStatement"
        ? statement.consequent.body
        : [statement.consequent];
    for (const inner of body) collectMemberAssignment(inner, memberAssignments, statement.test);
    return;
  }
  if (statement.type !== "ExpressionStatement") return;
  const expression = statement.expression;
  if (isObjectAssignCall(expression)) {
    const [target, source] = expression.arguments;
    if (target.type !== "Identifier" || source?.type !== "ObjectExpression") return;
    for (const property of source.properties) {
      if (property.type !== "Property" || property.kind !== "init") continue;
      const propertyName = getStaticPropertyName(property.key, property.computed);
      if (propertyName === null) continue;
      memberAssignments.push({
        objectName: target.name,
        propertyName,
        value: property.value,
        condition,
        span: statement,
      });
    }
    return;
  }
  if (expression.type !== "AssignmentExpression" || expression.operator !== "=") return;
  const target = expression.left;
  if (target.type !== "MemberExpression" || target.computed) return;
  if (target.object.type !== "Identifier" || target.property.type !== "Identifier") return;
  memberAssignments.push({
    objectName: target.object.name,
    propertyName: target.property.name,
    value: expression.right,
    condition,
    span: statement,
  });
};

const MUTATING_METHODS = new Set([
  "set",
  "add",
  "delete",
  "clear",
  "push",
  "pop",
  "shift",
  "unshift",
  "splice",
  "sort",
  "reverse",
  "fill",
  "copyWithin",
]);

const getMutatedObjectName = (node: Node): string | null => {
  switch (node.type) {
    case "CallExpression": {
      const callee = node.callee;
      if (callee.type !== "MemberExpression" || callee.object.type !== "Identifier") return null;
      const method = callee.computed ? null : callee.property;
      return method?.type === "Identifier" && MUTATING_METHODS.has(method.name)
        ? callee.object.name
        : null;
    }
    case "AssignmentExpression":
    case "UpdateExpression": {
      const target = node.type === "AssignmentExpression" ? node.left : node.argument;
      return target.type === "MemberExpression" && target.object.type === "Identifier"
        ? target.object.name
        : null;
    }
    case "UnaryExpression":
      return node.operator === "delete" &&
        node.argument.type === "MemberExpression" &&
        node.argument.object.type === "Identifier"
        ? node.argument.object.name
        : null;
    default:
      return null;
  }
};

/**
 * Module-level containers mutated from inside a function may be filled in by
 * code the interpreter never sees run (other modules calling an exported
 * `register`, effects, event handlers), so their contents are not exact.
 */
const collectDeferredMutations = (
  node: Node,
  isInsideFunction: boolean,
  names: Set<string>,
): void => {
  if (isInsideFunction) {
    const name = getMutatedObjectName(node);
    if (name !== null) names.add(name);
  }
  const isEnteringFunction = isInsideFunction || isFunctionLikeNode(node);
  forEachChildNode(node, (child) => collectDeferredMutations(child, isEnteringFunction, names));
};

const getStaticPropertyName = (property: PropertyKey, computed: boolean): string | null => {
  if (!computed && property.type === "Identifier") return property.name;
  if (computed && property.type === "Literal" && typeof property.value === "string") {
    return property.value;
  }
  return null;
};

const isObjectAssignCall = (node: Expression): node is CallExpression =>
  node.type === "CallExpression" &&
  node.callee.type === "MemberExpression" &&
  !node.callee.computed &&
  node.callee.object.type === "Identifier" &&
  node.callee.object.name === "Object" &&
  node.callee.property.type === "Identifier" &&
  node.callee.property.name === "assign";

/** `exports` or `module.exports`, the CommonJS export objects. */
const isExportsObject = (node: Expression): boolean =>
  (node.type === "Identifier" && node.name === "exports") ||
  (node.type === "MemberExpression" &&
    !node.computed &&
    node.object.type === "Identifier" &&
    node.object.name === "module" &&
    node.property.type === "Identifier" &&
    node.property.name === "exports");

/** `exports.name` / `module.exports.name` / `exports["name"]`. */
const getExportedMemberName = (node: Expression): string | null => {
  if (node.type !== "MemberExpression" || !isExportsObject(node.object)) return null;
  return getStaticPropertyName(node.property, node.computed);
};

const getRequiredSpecifier = (node: Expression): string | null => {
  if (
    node.type === "CallExpression" &&
    node.callee.type === "Identifier" &&
    node.callee.name === "require" &&
    node.arguments.length === 1
  ) {
    const [argument] = node.arguments;
    if (argument.type === "Literal" && typeof argument.value === "string") return argument.value;
  }
  return null;
};

/** Unwraps `_interopRequireDefault(require("x"))`-style helper calls around a `require`. */
const getWrappedRequiredSpecifier = (node: Expression): string | null => {
  const direct = getRequiredSpecifier(node);
  if (direct !== null) return direct;
  if (node.type === "CallExpression" && node.arguments.length >= 1) {
    const [argument] = node.arguments;
    if (argument.type !== "SpreadElement") return getRequiredSpecifier(argument);
  }
  return null;
};

const isVoidZero = (node: Expression): boolean =>
  node.type === "UnaryExpression" && node.operator === "void";

/** Return expression of a `get() { return x; }` accessor or `() => x`. */
const getGetterExpression = (node: Expression): Expression | null => {
  if (node.type !== "FunctionExpression" && node.type !== "ArrowFunctionExpression") return null;
  if (!node.body) return null;
  if (node.body.type !== "BlockStatement") return node.body;
  const [statement] = node.body.body;
  return statement?.type === "ReturnStatement" ? statement.argument : null;
};

class CommonJsCollector {
  /** Later assignments replace earlier ones, so `exports.x = void 0` placeholders yield to the real value. */
  readonly exports = new Map<string, ExportEntry>();
  readonly reExportAll: string[] = [];
  isCommonJs = false;

  constructor(private readonly requiredBindings: Map<string, string>) {}

  private setExport(entry: Exclude<ExportEntry, ReExportAll>): void {
    this.isCommonJs = true;
    this.exports.set(entry.exportedName, entry);
  }

  private setExpression(exportedName: string, expression: Expression): void {
    if (isVoidZero(expression)) {
      this.isCommonJs = true;
      if (!this.exports.has(exportedName)) {
        this.exports.set(exportedName, { kind: "expression", exportedName, expression });
      }
      return;
    }
    this.setExport({ kind: "expression", exportedName, expression });
  }

  private addReExportAll(specifier: string): void {
    this.isCommonJs = true;
    this.reExportAll.push(specifier);
  }

  /** `module.exports = value` exposes `value` as default and its literal members as named exports. */
  private setModuleExports(value: Expression): void {
    const specifier = getRequiredSpecifier(value);
    if (specifier !== null) {
      this.addReExportAll(specifier);
      this.setExport({
        kind: "re-export",
        exportedName: "default",
        imported: { kind: "default" },
        specifier,
      });
      return;
    }
    this.setExpression("default", value);
    if (value.type === "ObjectExpression") this.collectObjectMembers(value);
  }

  private collectObjectMembers(object: ObjectExpression): void {
    for (const property of object.properties) {
      if (property.type !== "Property" || property.kind !== "init") continue;
      const name = getStaticPropertyName(property.key, property.computed);
      if (name !== null) this.setExpression(name, property.value);
    }
  }

  /** Follows `exports.a = exports.b = value` chains; returns the innermost value. */
  collectAssignment(expression: Expression, localName: string | null): Expression {
    if (expression.type !== "AssignmentExpression" || expression.operator !== "=") {
      return expression;
    }
    const value = this.collectAssignment(expression.right, localName);
    if (expression.left.type !== "MemberExpression" && expression.left.type !== "Identifier") {
      return value;
    }
    if (isExportsObject(expression.left)) {
      this.setModuleExports(value);
      return value;
    }
    const exportedName = getExportedMemberName(expression.left);
    if (exportedName === null) return value;
    if (localName !== null) {
      this.setExport({ kind: "local", exportedName, localName });
    } else {
      this.setExpression(exportedName, value);
    }
    return value;
  }

  collectCall(call: CallExpression): void {
    const { callee } = call;
    const args = call.arguments.filter((argument) => argument.type !== "SpreadElement");
    if (args.length !== call.arguments.length) return;
    if (
      callee.type === "MemberExpression" &&
      !callee.computed &&
      callee.property.type === "Identifier"
    ) {
      const method = callee.property.name;
      if (
        callee.object.type === "Identifier" &&
        callee.object.name === "Object" &&
        method === "defineProperty" &&
        args.length === 3 &&
        isExportsObject(args[0])
      ) {
        this.collectDefineProperty(args[1], args[2]);
        return;
      }
      if (method === "forEach" && args.length === 1) {
        this.collectKeysForEach(callee.object);
        return;
      }
      if (method === "__exportStar" && args.length === 2) this.collectExportStar(args[0], args[1]);
      return;
    }
    if (callee.type === "Identifier" && /^_*(__exportStar|exportStar)$/.test(callee.name)) {
      if (args.length === 2) this.collectExportStar(args[0], args[1]);
    }
  }

  private collectDefineProperty(key: Expression, descriptor: Expression): void {
    if (key.type !== "Literal" || typeof key.value !== "string") return;
    if (descriptor.type !== "ObjectExpression") return;
    for (const property of descriptor.properties) {
      if (property.type !== "Property") continue;
      const name = getStaticPropertyName(property.key, property.computed);
      if (name === "value") {
        this.setExpression(key.value, property.value);
        return;
      }
      if (name === "get") {
        const expression = getGetterExpression(property.value);
        if (expression) this.setExpression(key.value, expression);
        return;
      }
    }
  }

  /** Babel's `export *`: `Object.keys(_mod).forEach(function (key) { ... exports[key] = _mod[key] })`. */
  private collectKeysForEach(receiver: Expression): void {
    if (receiver.type !== "CallExpression" || receiver.arguments.length !== 1) return;
    const { callee } = receiver;
    if (
      callee.type !== "MemberExpression" ||
      callee.computed ||
      callee.object.type !== "Identifier" ||
      callee.object.name !== "Object" ||
      callee.property.type !== "Identifier" ||
      callee.property.name !== "keys"
    ) {
      return;
    }
    const [namespace] = receiver.arguments;
    if (namespace.type !== "Identifier") return;
    const specifier = this.requiredBindings.get(namespace.name);
    if (specifier !== undefined) this.addReExportAll(specifier);
  }

  /** TypeScript's `export *`: `__exportStar(require("./x"), exports)`. */
  private collectExportStar(source: Expression, target: Expression): void {
    if (!isExportsObject(target)) return;
    const specifier =
      getRequiredSpecifier(source) ??
      (source.type === "Identifier" ? (this.requiredBindings.get(source.name) ?? null) : null);
    if (specifier !== null) this.addReExportAll(specifier);
  }

  collectStatement(statement: Statement): void {
    if (statement.type === "ExpressionStatement") {
      const { expression } = statement;
      if (expression.type === "AssignmentExpression") this.collectAssignment(expression, null);
      else if (expression.type === "CallExpression") this.collectCall(expression);
      return;
    }
    if (statement.type !== "VariableDeclaration") return;
    for (const declarator of statement.declarations) {
      if (!declarator.init || declarator.init.type !== "AssignmentExpression") continue;
      const localName = declarator.id.type === "Identifier" ? declarator.id.name : null;
      this.collectAssignment(declarator.init, localName);
    }
  }
}

/** Top-level `var x = require("spec")` (optionally wrapped in an interop helper) by binding name. */
const collectRequiredBindings = (statements: Statement[]): Map<string, string> => {
  const required = new Map<string, string>();
  for (const statement of statements) {
    if (statement.type !== "VariableDeclaration") continue;
    for (const declarator of statement.declarations) {
      if (declarator.id.type !== "Identifier" || !declarator.init) continue;
      const specifier = getWrappedRequiredSpecifier(declarator.init);
      if (specifier !== null) required.set(declarator.id.name, specifier);
    }
  }
  return required;
};

const collectCommonJsExports = (
  statements: Statement[],
  bindings: Map<string, TopLevelBinding>,
  exports: ExportEntry[],
): boolean => {
  const collector = new CommonJsCollector(collectRequiredBindings(statements));
  for (const statement of statements) collector.collectStatement(statement);
  if (!collector.isCommonJs) return false;
  for (const entry of collector.exports.values()) {
    if (
      entry.kind === "expression" &&
      entry.expression.type === "Identifier" &&
      bindings.has(entry.expression.name)
    ) {
      exports.push({
        kind: "local",
        exportedName: entry.exportedName,
        localName: entry.expression.name,
      });
      continue;
    }
    exports.push(entry);
  }
  for (const specifier of collector.reExportAll) exports.push({ kind: "re-export-all", specifier });
  return true;
};

export const createModuleRecord = (file: ParsedSourceFile): ModuleRecord => {
  const imports: ImportBinding[] = [];
  const exports: ExportEntry[] = [];
  const bindings = new Map<string, TopLevelBinding>();
  const memberAssignments: MemberAssignment[] = [];
  const deferredMutations = new Set<string>();
  const directives: string[] = [];
  for (const statement of file.program.body) {
    if (
      statement.type === "ExpressionStatement" &&
      "directive" in statement &&
      typeof statement.directive === "string"
    ) {
      directives.push(statement.directive);
      continue;
    }
    collectStatement(statement, imports, exports, bindings);
    collectMemberAssignment(statement, memberAssignments);
    collectDeferredMutations(statement, false, deferredMutations);
  }
  for (const importBinding of imports) {
    if (importBinding.isTypeOnly) continue;
    bindings.set(importBinding.localName, {
      kind: "import",
      name: importBinding.localName,
      binding: importBinding,
      span: importBinding.span,
    });
  }
  const isCommonJs =
    imports.length === 0 &&
    exports.length === 0 &&
    collectCommonJsExports(file.program.body, bindings, exports);
  return {
    filePath: file.filePath,
    file,
    directives,
    imports,
    exports,
    bindings,
    memberAssignments,
    deferredMutations,
    isCommonJs,
  };
};
