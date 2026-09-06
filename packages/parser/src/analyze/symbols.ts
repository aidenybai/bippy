import type { LinkedSymbol } from "../link/linker.js";
import { isAnonymousFunctionDefinition } from "../module/ast.js";
import {
  type DeclarationBinding,
  DEFAULT_EXPORT_NAME,
  type ImportBinding,
  NAMESPACE_IMPORT_NAME,
  type ParsedModule,
} from "../module/types.js";
import { normalizeExternal } from "./access.js";
import { classifyClass } from "./components.js";
import { evaluateEnum } from "./enums.js";
import type { Interpreter } from "./interpreter.js";
import { bindPattern } from "./patterns.js";
import { createScope, declareVariable, type Scope } from "./scope.js";
import {
  assignStatic,
  forgetStatics,
  nameValue,
  type StaticValue,
  UNDEFINED,
  unknown,
} from "./values.js";

export const getModuleScope = (interpreter: Interpreter, module: ParsedModule): Scope => {
  let scope = interpreter.moduleScopes.get(module);
  if (!scope) {
    scope = createScope(null);
    interpreter.moduleScopes.set(module, scope);
  }
  return scope;
};

/**
 * Members a module assigns to a function or component after declaring it
 * (`Card.Header = Header`, `Form.displayName = "Form"`). They are folded
 * once the binding is declared, so an initializer that refers back to the
 * binding sees the value rather than a cycle.
 */
const applyAssignedStatics = (
  interpreter: Interpreter,
  module: ParsedModule,
  localName: string,
  value: StaticValue,
): void => {
  if (value.kind !== "function" && value.kind !== "component") return;
  const { members, hasUntrackedWrites } = interpreter.linker.getMemberAssignments(
    module,
    localName,
  );
  for (const [key, assigned] of members) {
    const staticValue = interpreter.evaluateExpression(
      assigned,
      interpreter.createModuleContext(module),
    );
    assignStatic(value, key, staticValue);
  }
  if (hasUntrackedWrites) forgetStatics(value);
};

const evaluateDeclaration = (
  interpreter: Interpreter,
  module: ParsedModule,
  binding: DeclarationBinding,
): StaticValue => {
  const scope = getModuleScope(interpreter, module);
  const context = interpreter.createModuleContext(module);
  const node = binding.node;
  switch (node.type) {
    case "VariableDeclarator": {
      if (!node.init) return unknown(`${binding.localName} declared without an initializer`);
      const value = interpreter.evaluateExpression(node.init, context);
      if (node.id.type === "Identifier") {
        return nameValue(value, binding.localName, isAnonymousFunctionDefinition(node.init));
      }
      bindPattern(interpreter, node.id, value, context);
      return scope.variables.get(binding.localName) ?? UNDEFINED;
    }
    case "ClassDeclaration":
    case "ClassExpression":
      return classifyClass(interpreter, node, module, scope, binding.localName, context);
    case "TSEnumDeclaration":
      return evaluateEnum(interpreter, node, context);
    default:
      return {
        kind: "function",
        fn: node,
        module,
        scope,
        thisValue: null,
        name: node.id?.name ?? binding.localName,
        statics: new Map(),
        hasUnknownStatics: false,
      };
  }
};

const importValue = (
  interpreter: Interpreter,
  module: ParsedModule,
  binding: ImportBinding,
): StaticValue => {
  if (binding.isTypeOnly) return unknown(`type-only import ${binding.localName}`);
  const value = valueFromSymbol(
    interpreter,
    interpreter.linker.resolveReference(module, [binding.localName]),
  );
  if (value.kind !== "external" || value.name !== null) return value;
  const isNamedImport =
    binding.importedName !== DEFAULT_EXPORT_NAME && binding.importedName !== NAMESPACE_IMPORT_NAME;
  return { ...value, name: isNamedImport ? binding.importedName : binding.localName };
};

/**
 * Value of a module's top-level binding, evaluated lazily in module scope
 * and cached there. Cycles resolve to an unknown value instead of looping.
 */
export const resolveModuleBinding = (
  interpreter: Interpreter,
  module: ParsedModule,
  name: string,
): StaticValue | null => {
  const scope = getModuleScope(interpreter, module);
  const cached = scope.variables.get(name);
  if (cached) return cached;
  const binding = module.bindings.get(name);
  if (!binding) return null;
  declareVariable(scope, name, unknown(`cyclic reference to ${name}`));
  const value =
    binding.kind === "import"
      ? importValue(interpreter, module, binding)
      : evaluateDeclaration(interpreter, module, binding);
  declareVariable(scope, name, value);
  applyAssignedStatics(interpreter, module, name, value);
  return value;
};

export const valueFromSymbol = (interpreter: Interpreter, symbol: LinkedSymbol): StaticValue => {
  switch (symbol.kind) {
    case "declaration":
      return (
        resolveModuleBinding(interpreter, symbol.module, symbol.localName) ??
        unknown(`missing binding ${symbol.localName}`)
      );
    case "value": {
      const cacheKey = `${symbol.module.filePath}@${symbol.node.start}`;
      const cached = interpreter.valueCache.get(cacheKey);
      if (cached) return cached;
      interpreter.valueCache.set(cacheKey, unknown(`cyclic export ${symbol.exportedName}`));
      const context = interpreter.createModuleContext(symbol.module);
      const isNamedExport =
        symbol.exportedName !== DEFAULT_EXPORT_NAME && symbol.exportedName !== "";
      const value = nameValue(
        interpreter.evaluateExpression(symbol.node, context),
        isNamedExport ? symbol.exportedName : null,
        isAnonymousFunctionDefinition(symbol.node),
      );
      interpreter.valueCache.set(cacheKey, value);
      return value;
    }
    case "namespace":
      return { kind: "namespace", module: symbol.module };
    case "external":
      return normalizeExternal({
        kind: "external",
        specifier: symbol.specifier,
        packageName: symbol.packageName,
        importedName: symbol.importedName,
        memberPath: symbol.memberPath,
        name: null,
      });
    case "unresolved":
      return unknown(
        `unresolved ${[symbol.name, ...symbol.memberPath].join(".")} (${symbol.reason})`,
      );
  }
};

export const getModuleExport = (
  interpreter: Interpreter,
  module: ParsedModule,
  exportedName: string,
): StaticValue =>
  valueFromSymbol(interpreter, interpreter.linker.resolveExport(module, exportedName));
