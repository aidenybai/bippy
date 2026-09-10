import type {
  CallExpression,
  ExportDefaultDeclaration,
  ExportNamedDeclaration,
  Expression,
  FunctionBody,
  ImportDeclaration,
  ModuleExportName,
  ObjectExpression,
  ParamPattern,
  PropertyKey,
  Statement,
  VariableDeclaration,
} from "oxc-parser";
import { decideInlinedNodeEnvTest } from "../evaluate/bundler-globals.js";
import {
  getTypeScriptDeclarationName,
  type TypeScriptDeclaration,
} from "../evaluate/typescript-declarations.js";
import { getPatternNames, getVariableDeclaration, unwrapExpression } from "../parse/ast-walk.js";
import type {
  ExportEntry,
  ImportBinding,
  ImportedName,
  ModuleRecord,
  ParsedSourceFile,
  ReExportAll,
  TopLevelBinding,
} from "../types.js";

/** A function expression with a block body, as UMD/IIFE module wrappers are. */
interface BlockFunction {
  params: ParamPattern[];
  body: FunctionBody;
}

const getModuleExportName = (name: ModuleExportName): string =>
  name.type === "Literal" ? name.value : name.name;

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
    for (const name of getPatternNames(declarator.id)) {
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

const collectTypeScriptBinding = (
  declaration: TypeScriptDeclaration,
  bindings: Map<string, TopLevelBinding>,
): string | null => {
  const name = getTypeScriptDeclarationName(declaration);
  if (name !== null) {
    bindings.set(name, { kind: "typescript", name, node: declaration, span: declaration });
  }
  return name;
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
    } else if (declared.type === "TSEnumDeclaration" || declared.type === "TSModuleDeclaration") {
      const name = collectTypeScriptBinding(declared, bindings);
      if (name !== null) exports.push({ kind: "local", exportedName: name, localName: name });
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

const isCommonJsExportStatement = (statement: Statement): boolean => {
  if (statement.type === "ReturnStatement") return true;
  if (statement.type !== "ExpressionStatement") return false;
  const { expression } = statement;
  if (expression.type === "AssignmentExpression") {
    const target = expression.left;
    return (
      (target.type === "Identifier" || target.type === "MemberExpression") &&
      (isExportsObject(target) || getExportedMemberName(target) !== null)
    );
  }
  return (
    expression.type === "CallExpression" &&
    expression.arguments.some(
      (argument) => argument.type !== "SpreadElement" && isExportsObject(argument),
    )
  );
};

const DECLARATION_STATEMENT_TYPES = new Set<Statement["type"]>([
  "ImportDeclaration",
  "ExportNamedDeclaration",
  "ExportDefaultDeclaration",
  "ExportAllDeclaration",
  "VariableDeclaration",
  "FunctionDeclaration",
  "ClassDeclaration",
  "TSEnumDeclaration",
  "TSModuleDeclaration",
  "TSInterfaceDeclaration",
  "TSTypeAliasDeclaration",
  "TSDeclareFunction",
  "TSImportEqualsDeclaration",
  "TSExportAssignment",
  "TSNamespaceExportDeclaration",
  "EmptyStatement",
]);

const CALL_LIKE_EXPRESSION_TYPES = new Set<Expression["type"]>(["CallExpression", "NewExpression"]);

/** `const [Provider, useX] = createContext()` runs when the module does: the call may mutate state its siblings close over. */
const isCallInitializedDeclaration = (statement: Statement): boolean =>
  getVariableDeclaration(statement)?.declarations.some(
    (declarator) =>
      declarator.init !== null &&
      CALL_LIKE_EXPRESSION_TYPES.has(unwrapExpression(declarator.init).type),
  ) === true;

const isSideEffectStatement = (statement: Statement): boolean =>
  isCallInitializedDeclaration(statement) ||
  (!DECLARATION_STATEMENT_TYPES.has(statement.type) && !isCommonJsExportStatement(statement));

const isOutParameterCall = (
  init: Expression | null,
  bindings: ReadonlyMap<string, TopLevelBinding>,
): boolean =>
  (init?.type === "CallExpression" || init?.type === "NewExpression") &&
  init.arguments.some((argument) => {
    if (argument.type !== "Identifier") return false;
    const kind = bindings.get(argument.name)?.kind;
    return kind === "variable" || kind === "destructured";
  });

const collectOutParameterBindings = (bindings: ReadonlyMap<string, TopLevelBinding>): string[] => {
  const names: string[] = [];
  for (const binding of bindings.values()) {
    if (
      (binding.kind === "variable" || binding.kind === "destructured") &&
      isOutParameterCall(binding.init, bindings)
    ) {
      names.push(binding.name);
    }
  }
  return names;
};

const collectStatement = (
  statement: Statement,
  imports: ImportBinding[],
  exports: ExportEntry[],
  bindings: Map<string, TopLevelBinding>,
  dependencies: string[],
): void => {
  switch (statement.type) {
    case "ImportDeclaration":
      if (statement.importKind !== "type") dependencies.push(statement.source.value);
      collectImports(statement, imports);
      return;
    case "ExportNamedDeclaration":
      if (statement.source && statement.exportKind !== "type") {
        dependencies.push(statement.source.value);
      }
      collectNamedExports(statement, bindings, exports);
      return;
    case "ExportDefaultDeclaration":
      collectDefaultExport(statement, bindings, exports);
      return;
    case "ExportAllDeclaration":
      if (statement.exportKind === "type") return;
      dependencies.push(statement.source.value);
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
    case "TSEnumDeclaration":
    case "TSModuleDeclaration":
      collectTypeScriptBinding(statement, bindings);
      return;
    default:
      return;
  }
};

const getBranchBody = (statement: Statement): Statement[] =>
  statement.type === "BlockStatement" ? statement.body : [statement];

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

/** esbuild's `module.exports = __toCommonJS(ns_exports)`: the namespace object it converts. */
const getCommonJsNamespace = (node: Expression): Expression =>
  node.type === "CallExpression" &&
  node.callee.type === "Identifier" &&
  /^_*__toCommonJS$/.test(node.callee.name) &&
  node.arguments.length === 1 &&
  node.arguments[0].type !== "SpreadElement"
    ? node.arguments[0]
    : node;

const unwrapParentheses = (node: Expression): Expression =>
  node.type === "ParenthesizedExpression" ? unwrapParentheses(node.expression) : node;

const getBlockFunction = (node: Expression): BlockFunction | null => {
  const unwrapped = unwrapParentheses(node);
  if (unwrapped.type !== "FunctionExpression" && unwrapped.type !== "ArrowFunctionExpression") {
    return null;
  }
  const { params, body } = unwrapped;
  return body?.type === "BlockStatement" ? { params, body } : null;
};

const getCallExpression = (node: Expression): CallExpression | null => {
  let expression = unwrapParentheses(node);
  while (expression.type === "UnaryExpression") expression = unwrapParentheses(expression.argument);
  return expression.type === "CallExpression" ? expression : null;
};

const getWrapperCall = (statement: Statement): CallExpression | null =>
  statement.type === "ExpressionStatement" ? getCallExpression(statement.expression) : null;

/** The body of a parameterless IIFE such as `(function () { ... })()` or `!function () { ... }()`. */
const getIifeBody = (call: CallExpression | null): Statement[] | null => {
  if (!call || call.arguments.length !== 0) return null;
  const callee = getBlockFunction(call.callee);
  return callee && callee.params.length === 0 ? callee.body.body : null;
};

/**
 * Arguments of the factory call on a UMD wrapper's CommonJS path: none, the
 * exports object among `require`d dependencies (rollup's `factory(exports,
 * require("react"))`), or `require`d dependencies alone when the factory
 * returns its exports (webpack's `module.exports = factory(require("react"))`).
 */
const isFactoryCallArguments = (callArguments: CallExpression["arguments"]): boolean =>
  callArguments.every(
    (argument) =>
      argument.type !== "SpreadElement" &&
      (isExportsObject(argument) || getRequiredSpecifier(argument) !== null),
  ) ||
  callArguments.some((argument) => argument.type !== "SpreadElement" && isExportsObject(argument));

const getModuleWrapperBody = (statement: Statement): Statement[] | null =>
  getIifeBody(getWrapperCall(statement));

/** The `factory(exports, require("x"), …)` call on the CommonJS path of a UMD wrapper body. */
const findFactoryCall = (
  node: Expression | Statement,
  factoryName: string,
): CallExpression | null => {
  switch (node.type) {
    case "ExpressionStatement":
      return findFactoryCall(node.expression, factoryName);
    case "IfStatement":
      return (
        findFactoryCall(node.consequent, factoryName) ??
        (node.alternate ? findFactoryCall(node.alternate, factoryName) : null)
      );
    case "BlockStatement":
      for (const statement of node.body) {
        const call = findFactoryCall(statement, factoryName);
        if (call) return call;
      }
      return null;
    case "ConditionalExpression":
      return (
        findFactoryCall(node.consequent, factoryName) ??
        findFactoryCall(node.alternate, factoryName)
      );
    case "SequenceExpression":
      for (const expression of node.expressions) {
        const call = findFactoryCall(expression, factoryName);
        if (call) return call;
      }
      return null;
    case "AssignmentExpression":
      return findFactoryCall(node.right, factoryName);
    case "CallExpression":
      return node.callee.type === "Identifier" &&
        node.callee.name === factoryName &&
        isFactoryCallArguments(node.arguments)
        ? node
        : null;
    default:
      return null;
  }
};

/**
 * The factory body of a `(function (global, factory) { … })(this, function (exports, react) { … })`
 * UMD wrapper, binding each factory parameter to the argument the CommonJS path passes it
 * (`exports` to the exports object, `react` to `require("react")`). A factory not handed the
 * exports object (`module.exports = factory(require("react"))`) exports through its `return`.
 */
const getUmdFactoryBody = (
  statement: Statement,
  factoryArguments: Map<string, Expression>,
  factoryReturns: Set<Statement>,
): Statement[] | null => {
  const call = getWrapperCall(statement);
  if (!call || call.arguments.length !== 2) return null;
  const wrapper = getBlockFunction(call.callee);
  const [, factoryArgument] = call.arguments;
  const factory =
    factoryArgument.type === "SpreadElement" ? null : getBlockFunction(factoryArgument);
  const factoryParameter = wrapper?.params[1];
  if (!wrapper || !factory || factoryParameter?.type !== "Identifier") return null;
  const factoryCall = findFactoryCall(wrapper.body, factoryParameter.name);
  if (!factoryCall || factoryCall.arguments.length !== factory.params.length) return null;
  const bound = new Map<string, Expression>();
  let isHandedExports = false;
  for (const [index, parameter] of factory.params.entries()) {
    const argument = factoryCall.arguments[index];
    if (parameter.type !== "Identifier" || argument.type === "SpreadElement") return null;
    if (isExportsObject(argument)) {
      if (parameter.name !== "exports") return null;
      isHandedExports = true;
      continue;
    }
    bound.set(parameter.name, argument);
  }
  for (const [name, argument] of bound) factoryArguments.set(name, argument);
  if (!isHandedExports) {
    for (const inner of factory.body.body) {
      if (inner.type === "ReturnStatement") factoryReturns.add(inner);
    }
  }
  return factory.body.body;
};

/** Parameter names the wrapper body assigns as `module.exports = name()`, through `if` branches. */
const collectReturningFactoryNames = (statements: Statement[], names: Set<string>): void => {
  for (const statement of statements) {
    if (statement.type === "IfStatement") {
      collectReturningFactoryNames(getBranchBody(statement.consequent), names);
      if (statement.alternate)
        collectReturningFactoryNames(getBranchBody(statement.alternate), names);
      continue;
    }
    if (statement.type !== "ExpressionStatement") continue;
    const { expression } = statement;
    if (
      expression.type === "AssignmentExpression" &&
      expression.operator === "=" &&
      (expression.left.type === "Identifier" || expression.left.type === "MemberExpression") &&
      isExportsObject(expression.left) &&
      expression.right.type === "CallExpression" &&
      expression.right.callee.type === "Identifier" &&
      expression.right.arguments.length === 0
    ) {
      names.add(expression.right.callee.name);
    }
  }
};

/**
 * The body of the parameterless factory a `(function (name, root, definition) { … module.exports = definition() … })("x", this, function () { … })`
 * UMD wrapper hands to `module.exports`; its `return` becomes the module's `module.exports`.
 */
const getReturningFactoryBody = (
  statement: Statement,
  factoryReturns: Set<Statement>,
): Statement[] | null => {
  const call = getWrapperCall(statement);
  const wrapper = call ? getBlockFunction(call.callee) : null;
  if (!call || !wrapper || wrapper.params.length !== call.arguments.length) return null;
  const factoryNames = new Set<string>();
  collectReturningFactoryNames(wrapper.body.body, factoryNames);
  const factories = wrapper.params.flatMap((parameter, index) => {
    const argument = call.arguments[index];
    if (parameter.type !== "Identifier" || !factoryNames.has(parameter.name)) return [];
    if (argument === undefined || argument.type === "SpreadElement") return [];
    const factory = getBlockFunction(argument);
    return factory && factory.params.length === 0 ? [factory.body.body] : [];
  });
  const [body] = factories;
  if (factories.length !== 1 || !body) return null;
  for (const inner of body) {
    if (inner.type === "ReturnStatement") factoryReturns.add(inner);
  }
  return body;
};

/**
 * The branch a `process.env.NODE_ENV` guard takes once the bundler has inlined
 * the mode: React's development builds wrap their body in
 * `if (…) { (function () { … })(); }` or `"production" !== … && (function () { … })()`.
 */
const getInlinedNodeEnvBranch = (statement: Statement): Statement[] | null => {
  if (statement.type === "IfStatement") {
    const isTaken = decideInlinedNodeEnvTest(statement.test);
    if (isTaken === null) return null;
    if (isTaken) return getBranchBody(statement.consequent);
    return statement.alternate ? getBranchBody(statement.alternate) : [];
  }
  if (statement.type !== "ExpressionStatement") return null;
  const expression = unwrapParentheses(statement.expression);
  if (expression.type !== "LogicalExpression" || expression.operator === "??") return null;
  const isTaken = decideInlinedNodeEnvTest(expression.left);
  if (isTaken === null) return null;
  if (isTaken !== (expression.operator === "&&")) return [];
  return getIifeBody(getCallExpression(expression.right));
};

/** Module-level statements, with UMD/IIFE wrappers and decided build guards flattened so their declarations become module bindings. */
const getModuleStatements = (
  statements: Statement[],
  factoryArguments: Map<string, Expression>,
  factoryReturns: Set<Statement>,
): Statement[] =>
  statements.flatMap((statement) => {
    const body =
      getModuleWrapperBody(statement) ??
      getInlinedNodeEnvBranch(statement) ??
      getUmdFactoryBody(statement, factoryArguments, factoryReturns) ??
      getReturningFactoryBody(statement, factoryReturns);
    return body ? getModuleStatements(body, factoryArguments, factoryReturns) : [statement];
  });

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
  /** esbuild's `__export(ns_exports, { name: () => value })` getters by namespace binding. */
  private readonly namespaceGetters = new Map<string, ObjectExpression>();
  isCommonJs = false;
  moduleExports: Expression | null = null;
  readonly moduleExportsMembers: string[] = [];

  constructor(
    private readonly factoryReturns: ReadonlySet<Statement>,
    private readonly requiredBindings: Map<string, string>,
    private readonly bindings: Map<string, TopLevelBinding>,
  ) {}

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
  private setModuleExports(assigned: Expression): void {
    this.moduleExports = assigned;
    const value = getCommonJsNamespace(assigned);
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
    const aliasedName = getExportedMemberName(value);
    const aliased = aliasedName === null ? undefined : this.exports.get(aliasedName);
    if (aliased && aliased.kind !== "re-export-all") {
      this.exports.set("default", { ...aliased, exportedName: "default" });
      return;
    }
    this.setExpression("default", assigned);
    const object = this.getConstantObject(value);
    if (object) this.collectObjectMembers(object);
    const getters = value.type === "Identifier" ? this.namespaceGetters.get(value.name) : undefined;
    if (getters) this.collectObjectGetters(getters);
  }

  private collectObjectGetters(object: ObjectExpression): void {
    for (const property of object.properties) {
      if (property.type !== "Property" || property.kind !== "init") continue;
      const name = getStaticPropertyName(property.key, property.computed);
      const expression = getGetterExpression(property.value);
      if (name !== null && expression) this.setExpression(name, expression);
    }
  }

  /** The literal behind `module.exports = value`: the expression itself or the `const` it names. */
  private getConstantObject(value: Expression): ObjectExpression | null {
    if (value.type === "ObjectExpression") return value;
    if (value.type !== "Identifier") return null;
    const binding = this.bindings.get(value.name);
    return binding?.kind === "variable" &&
      binding.declarationKind === "const" &&
      binding.init?.type === "ObjectExpression"
      ? binding.init
      : null;
  }

  private collectObjectMembers(object: ObjectExpression): void {
    for (const property of object.properties) {
      if (property.type !== "Property" || property.kind !== "init") continue;
      const name = getStaticPropertyName(property.key, property.computed);
      if (name !== null) this.setExpression(name, property.value);
    }
  }

  /**
   * Export assignments and calls a minifier folded into one statement:
   * `exports.a = 1, exports.b = 2` or `(exports.default = X).propTypes = {}`.
   */
  private collectExpression(expression: Expression): void {
    switch (expression.type) {
      case "SequenceExpression":
        for (const item of expression.expressions) this.collectExpression(item);
        return;
      case "ParenthesizedExpression":
        this.collectExpression(expression.expression);
        return;
      case "AssignmentExpression":
        this.collectAssignment(expression, null);
        if (expression.left.type === "MemberExpression") {
          this.collectExpression(expression.left.object);
        }
        return;
      case "MemberExpression":
        this.collectExpression(expression.object);
        return;
      case "LogicalExpression":
        this.collectExpression(expression.left);
        this.collectExpression(expression.right);
        return;
      case "CallExpression":
        this.collectCall(expression);
        for (const argument of expression.arguments) {
          if (argument.type !== "SpreadElement") this.collectExpression(argument);
        }
    }
  }

  /** TypeScript's `export enum`/`export namespace` emit: `Name = exports.Name || (exports.Name = {})`. */
  private collectExportedAlias(localName: string, init: Expression): void {
    const value = unwrapParentheses(init);
    if (value.type !== "LogicalExpression" || value.operator !== "||") return;
    const exportedName = getExportedMemberName(value.left);
    if (exportedName === null) return;
    const fallback = unwrapParentheses(value.right);
    if (
      fallback.type === "AssignmentExpression" &&
      fallback.operator === "=" &&
      fallback.left.type === "MemberExpression" &&
      getExportedMemberName(fallback.left) === exportedName
    ) {
      this.setExport({ kind: "local", exportedName, localName });
    }
  }

  /** Follows `exports.a = exports.b = value` and `exports.a = local = value` chains; returns the innermost value. */
  collectAssignment(expression: Expression, localName: string | null): Expression {
    if (expression.type !== "AssignmentExpression" || expression.operator !== "=") {
      return expression;
    }
    const right = unwrapParentheses(expression.right);
    const assignedLocal =
      right.type === "AssignmentExpression" && right.left.type === "Identifier"
        ? right.left.name
        : localName;
    const value = this.collectAssignment(right, assignedLocal);
    if (expression.left.type === "Identifier") {
      this.collectExportedAlias(expression.left.name, value);
      return value;
    }
    if (expression.left.type !== "MemberExpression") return value;
    if (isExportsObject(expression.left)) {
      this.setModuleExports(value);
      return value;
    }
    const exportedName = getExportedMemberName(expression.left);
    if (exportedName === null) return value;
    if (
      this.moduleExports !== null &&
      expression.left.type === "MemberExpression" &&
      expression.left.object.type === "MemberExpression"
    ) {
      this.moduleExportsMembers.push(exportedName);
    }
    if (assignedLocal !== null) {
      this.setExport({ kind: "local", exportedName, localName: assignedLocal });
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
      if (isObjectAssignCall(call) && args.length === 2 && isExportsObject(args[0])) {
        if (args[1].type === "ObjectExpression") this.collectObjectMembers(args[1]);
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
      return;
    }
    if (callee.type === "Identifier" && /^_+export$/.test(callee.name) && args.length === 2) {
      const [target, members] = args;
      if (target.type !== "Identifier" || members.type !== "ObjectExpression") return;
      if (isExportsObject(target)) this.collectObjectGetters(members);
      else this.namespaceGetters.set(target.name, members);
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
    if (statement.type === "ReturnStatement") {
      if (statement.argument && this.factoryReturns.has(statement)) {
        this.setModuleExports(statement.argument);
      }
      return;
    }
    if (statement.type === "IfStatement") {
      for (const branch of getBranchBody(statement.consequent)) this.collectStatement(branch);
      if (statement.alternate) {
        for (const branch of getBranchBody(statement.alternate)) this.collectStatement(branch);
      }
      return;
    }
    if (statement.type === "ExpressionStatement") {
      this.collectExpression(statement.expression);
      return;
    }
    if (statement.type !== "VariableDeclaration") return;
    for (const declarator of statement.declarations) {
      if (!declarator.init) continue;
      const localName = declarator.id.type === "Identifier" ? declarator.id.name : null;
      if (declarator.init.type === "AssignmentExpression") {
        this.collectAssignment(declarator.init, localName);
      } else if (localName !== null) {
        this.collectExportedAlias(localName, declarator.init);
      }
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
  factoryReturns: ReadonlySet<Statement>,
  bindings: Map<string, TopLevelBinding>,
  exports: ExportEntry[],
): CommonJsCollector | null => {
  const collector = new CommonJsCollector(
    factoryReturns,
    collectRequiredBindings(statements),
    bindings,
  );
  for (const statement of statements) collector.collectStatement(statement);
  if (!collector.isCommonJs) return null;
  const carriesMembers = (expression: Expression): boolean =>
    expression === collector.moduleExports && collector.moduleExportsMembers.length > 0;
  for (const entry of collector.exports.values()) {
    if (
      entry.kind === "expression" &&
      entry.expression.type === "Identifier" &&
      bindings.has(entry.expression.name) &&
      !carriesMembers(entry.expression)
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
  return collector;
};

const USE_CLIENT_DIRECTIVE = "use client";

export const isClientModule = (module: ModuleRecord): boolean =>
  module.directives.includes(USE_CLIENT_DIRECTIVE);

export const hasExportedName = (module: ModuleRecord, exportedName: string): boolean =>
  module.exports.some((entry) => "exportedName" in entry && entry.exportedName === exportedName);

export const createModuleRecord = (file: ParsedSourceFile): ModuleRecord => {
  const imports: ImportBinding[] = [];
  const exports: ExportEntry[] = [];
  const bindings = new Map<string, TopLevelBinding>();
  const dependencies: string[] = [];
  const sideEffectStatements: Statement[] = [];
  const directives: string[] = [];
  const factoryArguments = new Map<string, Expression>();
  const factoryReturns = new Set<Statement>();
  const statements = getModuleStatements(file.program.body, factoryArguments, factoryReturns);
  for (const [name, argument] of factoryArguments) {
    bindings.set(name, {
      kind: "variable",
      name,
      init: argument,
      declarationKind: "const",
      span: argument,
    });
  }
  for (const statement of statements) {
    if (
      statement.type === "ExpressionStatement" &&
      "directive" in statement &&
      typeof statement.directive === "string"
    ) {
      directives.push(statement.directive);
      continue;
    }
    collectStatement(statement, imports, exports, bindings, dependencies);
    if (isSideEffectStatement(statement)) sideEffectStatements.push(statement);
  }
  for (const importBinding of imports) {
    // A declaration sharing an import's name is legal only when the import is a type; the build erases it.
    if (importBinding.isTypeOnly || bindings.has(importBinding.localName)) continue;
    bindings.set(importBinding.localName, {
      kind: "import",
      name: importBinding.localName,
      binding: importBinding,
      span: importBinding.span,
    });
  }
  const commonJs =
    imports.length === 0 && exports.length === 0
      ? collectCommonJsExports(statements, factoryReturns, bindings, exports)
      : null;
  return {
    filePath: file.filePath,
    file,
    directives,
    imports,
    exports,
    bindings,
    dependencies,
    sideEffectStatements,
    outParameterBindings: collectOutParameterBindings(bindings),
    isCommonJs: commonJs !== null,
    moduleExports: commonJs?.moduleExports ?? null,
    moduleExportsMembers: commonJs?.moduleExportsMembers ?? [],
  };
};
