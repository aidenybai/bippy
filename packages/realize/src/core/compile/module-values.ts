import { traverse, types } from "@babel/core";
import type { NodePath } from "@babel/core";
import type { Binding } from "@babel/traverse";
import { GeneratedSource } from "../../react-compiler/HIR/HIR";
import type { SourceLocation } from "../../react-compiler/HIR/HIR";
import type { PrimitiveValue, SymbolicValue } from "../types";
import { isStatelessRegExp } from "../interpret/is-stateless-regexp";
import { isModuleLevel } from "./is-module-level";

export interface ModuleConstantLoader {
  (constantName: string): SymbolicValue | null;
}

interface ModuleVariable {
  initial: SymbolicValue | null;
  loc: SourceLocation;
}

export interface ModuleVariableLoader {
  (variableName: string): ModuleVariable | null;
}

export interface ModuleDeclaration extends ModuleVariable {
  isWritten: boolean;
  isReadOnly: boolean;
}

export type ImportUse = "written" | "state" | "read";

interface ImportedName {
  localName: string;
  loc: SourceLocation;
}

export interface ImportedNames {
  specifiers: ImportedName[];
  namespaceSources: SourceLocation[];
  reexportSources: SourceLocation[];
  isReadOnly: (localName: string, value: SymbolicValue) => boolean;
}

export interface ModuleValues {
  declarations: Map<string, ModuleDeclaration>;
  constants: Map<string, SymbolicValue>;
  importUses: Map<string, ImportUse>;
  importedNames: ImportedNames;
}

const allOrNone = <Item>(items: Array<Item | null>): Item[] | null => {
  const present = items.filter((item): item is Item => item !== null);
  return present.length === items.length ? present : null;
};

const toSymbolicValue = (node: types.Node): SymbolicValue | null => {
  if (types.isStringLiteral(node) || types.isNumericLiteral(node) || types.isBooleanLiteral(node))
    return { kind: "Primitive", value: node.value };
  if (types.isNullLiteral(node)) return { kind: "Primitive", value: null };
  if (types.isRegExpLiteral(node))
    return { kind: "RegExp", pattern: node.pattern, flags: node.flags };
  if (types.isIdentifier(node) && node.name === "undefined")
    return { kind: "Primitive", value: undefined };
  if (types.isTemplateLiteral(node) && node.expressions.length === 0)
    return {
      kind: "Primitive",
      value: node.quasis.map((quasi) => quasi.value.cooked ?? "").join(""),
    };
  if (
    types.isUnaryExpression(node) &&
    node.operator === "-" &&
    types.isNumericLiteral(node.argument)
  )
    return { kind: "Primitive", value: -node.argument.value };
  if (
    types.isTSAsExpression(node) ||
    types.isTSSatisfiesExpression(node) ||
    types.isTSTypeAssertion(node) ||
    types.isTSNonNullExpression(node) ||
    types.isParenthesizedExpression(node)
  )
    return toSymbolicValue(node.expression);
  if (types.isNewExpression(node) && types.isIdentifier(node.callee)) {
    const collection =
      node.callee.name === "Set" || node.callee.name === "Map" ? node.callee.name : null;
    const [source] = node.arguments;
    const sourceValue =
      source && !types.isSpreadElement(source) && types.isExpression(source)
        ? toSymbolicValue(source)
        : null;
    if (!collection || node.arguments.length > 1 || (source && !sourceValue)) return null;
    return {
      kind: "Collection",
      collection,
      source: sourceValue,
      isCopy: false,
      writes: [],
      loc: node.loc ?? GeneratedSource,
    };
  }
  if (types.isArrayExpression(node)) {
    const elements = allOrNone(
      node.elements.map((element) =>
        element && !types.isSpreadElement(element) ? toSymbolicValue(element) : null,
      ),
    );
    return elements ? { kind: "ArrayExpression", elements, spreads: [] } : null;
  }
  if (types.isObjectExpression(node)) {
    const properties = allOrNone(
      node.properties.map((property) => {
        if (!types.isObjectProperty(property) || property.computed || property.shorthand)
          return null;
        const key = types.isIdentifier(property.key)
          ? property.key.name
          : types.isStringLiteral(property.key) || types.isNumericLiteral(property.key)
            ? String(property.key.value)
            : null;
        const value = toSymbolicValue(property.value);
        return key !== null && value ? { key, value } : null;
      }),
    );
    return properties ? { kind: "ObjectExpression", properties, spreads: [] } : null;
  }
  return null;
};

const getEnumMemberName = (member: types.TSEnumMember): string | null =>
  types.isIdentifier(member.id) ? member.id.name : member.id.value;

const getEnumObject = (declaration: types.TSEnumDeclaration): SymbolicValue | null => {
  const properties: Array<{ key: string; value: SymbolicValue }> = [];
  let next: number | null = 0;
  for (const member of declaration.members) {
    const name = getEnumMemberName(member);
    const initial = member.initializer ? toSymbolicValue(member.initializer) : null;
    const memberValue: PrimitiveValue | undefined =
      initial?.kind === "Primitive" ? initial.value : member.initializer ? undefined : next;
    if (name === null || (typeof memberValue !== "number" && typeof memberValue !== "string"))
      return null;
    properties.push({ key: name, value: { kind: "Primitive", value: memberValue } });
    if (typeof memberValue === "number")
      properties.push({ key: String(memberValue), value: { kind: "Primitive", value: name } });
    next = typeof memberValue === "number" ? memberValue + 1 : null;
  }
  return { kind: "ObjectExpression", properties, spreads: [] };
};

const getMemberKey = (
  member: types.MemberExpression | types.OptionalMemberExpression,
): string | null => {
  if (!member.computed && types.isIdentifier(member.property)) return member.property.name;
  if (types.isStringLiteral(member.property) || types.isNumericLiteral(member.property))
    return String(member.property.value);
  return null;
};

const getMemberValues = (
  value: SymbolicValue,
  member: types.MemberExpression | types.OptionalMemberExpression,
): SymbolicValue[] => {
  const key = getMemberKey(member);
  if (value.kind === "ArrayExpression") {
    if (key === "length") return [{ kind: "Primitive", value: value.elements.length }];
    return key === null
      ? value.elements
      : value.elements.filter((_element, index) => String(index) === key);
  }
  if (value.kind !== "ObjectExpression") return [];
  return value.properties
    .filter((property) => key === null || property.key === key)
    .map((property) => property.value);
};

const isPrimitive = (value: SymbolicValue): boolean => value.kind === "Primitive";

const isWriteTarget = (path: NodePath): boolean => {
  if (!path.parentPath) return false;
  return (
    path.parentPath.isAssignmentExpression({ left: path.node }) ||
    path.parentPath.isUpdateExpression() ||
    path.parentPath.isUnaryExpression({ operator: "delete" })
  );
};

const LIST_READS = new Set(["includes", "indexOf", "at", "get", "has"]);

const CALLBACK_READS = new Set(["find", "findLast", "findIndex"]);

const OBJECT_READS = new Set(["keys", "values", "entries"]);

const isLiteralList = (value: SymbolicValue): boolean =>
  value.kind === "ArrayExpression" &&
  value.spreads.length === 0 &&
  value.elements.every(isPrimitive);

const isLiteralEntries = (value: SymbolicValue | null): boolean =>
  value === null ||
  (value.kind === "ArrayExpression" &&
    value.spreads.length === 0 &&
    value.elements.every((element) => isPrimitive(element) || isLiteralList(element)));

const isLiteralTable = (value: SymbolicValue): boolean =>
  value.kind === "ObjectExpression" &&
  value.spreads.length === 0 &&
  value.properties.every((property) => isPrimitive(property.value));

const isLiteralContainer = (value: SymbolicValue): boolean =>
  isLiteralList(value) ||
  (value.kind === "Collection" && value.writes.length === 0 && isLiteralEntries(value.source));

const isCallbackWithoutArray = (node: types.Node | undefined): boolean =>
  (types.isArrowFunctionExpression(node) || types.isFunctionExpression(node)) &&
  node.params.length < 3;

const isListRead = (path: NodePath, values: SymbolicValue[]): boolean => {
  const member = path.parentPath?.node;
  const call = path.parentPath?.parentPath?.node;
  if (
    !types.isMemberExpression(member) ||
    member.object !== path.node ||
    !types.isIdentifier(member.property) ||
    member.computed ||
    !types.isCallExpression(call) ||
    call.callee !== member
  )
    return false;
  const methodName = member.property.name;
  const isRead =
    LIST_READS.has(methodName) ||
    (CALLBACK_READS.has(methodName) && isCallbackWithoutArray(call.arguments[0]));
  return isRead && values.every(isLiteralContainer);
};

const isObjectRead = (path: NodePath, values: SymbolicValue[]): boolean => {
  const call = path.parentPath?.node;
  if (!types.isCallExpression(call) || call.arguments[0] !== path.node) return false;
  return (
    types.isMemberExpression(call.callee) &&
    types.isIdentifier(call.callee.object, { name: "Object" }) &&
    types.isIdentifier(call.callee.property) &&
    OBJECT_READS.has(call.callee.property.name) &&
    values.every((value) => isLiteralList(value) || isLiteralTable(value))
  );
};

const isReadOfPrimitive = (
  path: NodePath,
  values: SymbolicValue[],
  receiverValues: SymbolicValue[],
): boolean => {
  if (isListRead(path, values) || isObjectRead(path, values)) return true;
  const member = path.parentPath?.node;
  const isMemberObject =
    (types.isMemberExpression(member) || types.isOptionalMemberExpression(member)) &&
    member.object === path.node;
  if (path.parentPath && isMemberObject)
    return isReadOfPrimitive(
      path.parentPath,
      values.flatMap((value) => getMemberValues(value, member)),
      values,
    );
  if (!values.every(isPrimitive) || isWriteTarget(path)) return false;
  const isCallee = path.parentPath?.isCallExpression({ callee: path.node }) ?? false;
  return !isCallee || receiverValues.every(isPrimitive);
};

const MUTATING_METHODS = new Set([
  "push",
  "pop",
  "shift",
  "unshift",
  "splice",
  "sort",
  "reverse",
  "fill",
  "copyWithin",
  "set",
  "delete",
  "add",
  "clear",
]);

const isMutatingMethodCallee = (path: NodePath): boolean => {
  const node = path.node;
  const isMember = types.isMemberExpression(node) || types.isOptionalMemberExpression(node);
  return (
    isMember &&
    !node.computed &&
    types.isIdentifier(node.property) &&
    MUTATING_METHODS.has(node.property.name) &&
    (path.parentPath?.isCallExpression({ callee: node }) === true ||
      path.parentPath?.isOptionalCallExpression({ callee: node }) === true)
  );
};

const isMemberWrite = (path: NodePath): boolean => {
  const member = path.parentPath?.node;
  const isMemberObject =
    (types.isMemberExpression(member) || types.isOptionalMemberExpression(member)) &&
    member.object === path.node;
  return (
    path.parentPath !== null &&
    isMemberObject &&
    (isWriteTarget(path.parentPath) ||
      isMutatingMethodCallee(path.parentPath) ||
      isMemberWrite(path.parentPath))
  );
};

const isMethodReceiver = (path: NodePath): boolean => {
  const member = path.parentPath;
  const call = member?.parentPath;
  return (
    member !== null &&
    (member.isMemberExpression({ object: path.node }) ||
      member.isOptionalMemberExpression({ object: path.node })) &&
    (call?.isCallExpression({ callee: member.node }) === true ||
      call?.isOptionalCallExpression({ callee: member.node }) === true)
  );
};

const isFunctionLike = (node: types.Node | null | undefined): boolean =>
  types.isFunctionExpression(node) ||
  types.isArrowFunctionExpression(node) ||
  types.isClassExpression(node);

const isLocalConstruction = (init: NodePath<types.Expression | null | undefined>): boolean => {
  if (!init.isCallExpression() && !init.isNewExpression()) return false;
  const callee = init.node.callee;
  const declaration = types.isIdentifier(callee)
    ? init.scope.getBinding(callee.name)?.path.node
    : null;
  return (
    isFunctionLike(callee) ||
    types.isFunctionDeclaration(declaration) ||
    types.isClassDeclaration(declaration) ||
    (types.isVariableDeclarator(declaration) && isFunctionLike(declaration.init))
  );
};

const getOwnThisPaths = (init: NodePath<types.Expression | null | undefined>): NodePath[] => {
  const callee = init.isNewExpression() ? init.get("callee") : null;
  const classPath = callee?.isIdentifier() ? init.scope.getBinding(callee.node.name)?.path : null;
  const owner = init.isObjectExpression()
    ? init
    : classPath?.isClassDeclaration()
      ? classPath
      : null;
  const thisPaths: NodePath[] = [];
  owner?.traverse({
    ThisExpression(thisPath) {
      thisPaths.push(thisPath);
    },
  });
  return thisPaths;
};

const HOOK_INITIAL_ARGUMENTS = new Map([
  ["useState", 0],
  ["useReducer", 1],
]);

const isHookInitialArgument = (path: NodePath): boolean => {
  const call = path.parentPath?.node;
  if (!types.isCallExpression(call)) return false;
  const callee = types.isMemberExpression(call.callee) ? call.callee.property : call.callee;
  return (
    types.isIdentifier(callee) &&
    HOOK_INITIAL_ARGUMENTS.get(callee.name) ===
      call.arguments.indexOf(path.node as types.Expression)
  );
};

const isUnmutatedStateSetterArgument = (path: NodePath): boolean => {
  const call = path.parentPath;
  if (!call?.isCallExpression() || call.node.arguments[0] !== path.node) return false;
  if (!types.isIdentifier(call.node.callee)) return false;
  const declarator = call.scope.getBinding(call.node.callee.name)?.path;
  if (!declarator?.isVariableDeclarator() || !types.isArrayPattern(declarator.node.id))
    return false;
  const hookCallee = types.isCallExpression(declarator.node.init)
    ? declarator.node.init.callee
    : null;
  const hook = types.isMemberExpression(hookCallee) ? hookCallee.property : hookCallee;
  const [stateElement, setterElement] = declarator.node.id.elements;
  if (
    !types.isIdentifier(hook, { name: "useState" }) ||
    !types.isIdentifier(setterElement, { name: call.node.callee.name }) ||
    !types.isIdentifier(stateElement)
  )
    return false;
  const stateBinding = declarator.scope.getBinding(stateElement.name);
  return stateBinding !== undefined && !stateBinding.referencePaths.some(isMemberWrite);
};

const isStateValueReference = (path: NodePath): boolean => {
  if (!path.parentPath) return false;
  if (path.parentPath.isSpreadElement() || path.parentPath.isReturnStatement()) return true;
  if (path.parentPath.isArrowFunctionExpression()) return path.parentPath.node.body === path.node;
  if (path.parentPath.isConditionalExpression())
    return path.parentPath.node.test !== path.node && isStateValueReference(path.parentPath);
  return isHookInitialArgument(path) || isUnmutatedStateSetterArgument(path);
};

const getFieldValues = (value: SymbolicValue): SymbolicValue[] => {
  if (value.kind === "ObjectExpression") return value.properties.map((property) => property.value);
  if (value.kind === "ArrayExpression") return value.elements;
  return [value];
};

const isSharedStateReference = (path: NodePath, value: SymbolicValue): boolean =>
  isStateValueReference(path) &&
  !(path.parentPath?.isSpreadElement() && getFieldValues(value).every(isPrimitive));

const isReadThroughState = (references: NodePath[], value: SymbolicValue): boolean =>
  !isPrimitive(value) &&
  references.some((reference) => isSharedStateReference(reference, value)) &&
  references.some((reference) => !isStateValueReference(reference));

const isOnlyReadOfPrimitives = (references: NodePath[], value: SymbolicValue): boolean =>
  !isReadThroughState(references, value) &&
  references.every(
    (reference) => isStateValueReference(reference) || isReadOfPrimitive(reference, [value], []),
  );

const getModuleDeclaration = (
  path: NodePath<types.VariableDeclarator>,
  kind: types.VariableDeclaration["kind"],
  binding: Binding | undefined,
  loc: SourceLocation,
): ModuleDeclaration => {
  const value = path.node.init ? toSymbolicValue(path.node.init) : null;
  const isWritten =
    binding !== undefined &&
    (binding.constantViolations.length > 0 ||
      binding.referencePaths.some(isMemberWrite) ||
      getOwnThisPaths(path.get("init")).some(isMemberWrite) ||
      (isLocalConstruction(path.get("init")) && binding.referencePaths.some(isMethodReceiver)) ||
      (value !== null && isReadThroughState(binding.referencePaths, value)));
  const isReadOnly =
    kind === "const" &&
    value !== null &&
    binding !== undefined &&
    binding.constantViolations.length === 0 &&
    isOnlyReadOfPrimitives(
      binding.referencePaths.filter((reference) => !reference.isExportNamedDeclaration()),
      value,
    );
  return {
    initial: path.node.init ? value : { kind: "Primitive", value: undefined },
    loc,
    isWritten,
    isReadOnly,
  };
};

const getModuleConstant = (
  init: types.Expression,
  isExported: boolean,
  binding: Binding | undefined,
): SymbolicValue | null => {
  const value = toSymbolicValue(init);
  if (!value) return null;
  const isUnchanged =
    isPrimitive(value) ||
    (isStatelessRegExp(value) &&
      binding !== undefined &&
      binding.constantViolations.length === 0 &&
      !binding.referencePaths.some(isMemberWrite)) ||
    (!isExported &&
      binding !== undefined &&
      binding.constantViolations.length === 0 &&
      isOnlyReadOfPrimitives(binding.referencePaths, value));
  return isUnchanged ? value : null;
};

const collectModuleEnums = (
  program: types.Program,
  unsafeEnums: Set<string>,
): Map<string, SymbolicValue> => {
  const enums = new Map<string, SymbolicValue>();
  for (const statement of program.body) {
    const declaration = types.isExportNamedDeclaration(statement)
      ? statement.declaration
      : statement;
    if (!types.isTSEnumDeclaration(declaration)) continue;
    const name = declaration.id.name;
    const value = getEnumObject(declaration);
    if (value && !enums.has(name)) enums.set(name, value);
    if (!value || enums.get(name) !== value) unsafeEnums.add(name);
  }
  return enums;
};

const isTypePosition = (path: NodePath<types.Identifier>): boolean =>
  path.parentPath.isTSTypeReference() ||
  path.parentPath.isTSQualifiedName() ||
  path.parentPath.isTSEnumDeclaration({ id: path.node });

export const collectModuleValues = (ast: types.File): ModuleValues => {
  const declarations = new Map<string, ModuleDeclaration>();
  const constants = new Map<string, SymbolicValue>();
  const importUses = new Map<string, ImportUse>();
  const specifiers: ImportedName[] = [];
  const namespaceSources: SourceLocation[] = [];
  const reexportSources: SourceLocation[] = [];
  const referencesByName = new Map<string, NodePath[]>();
  const unsafeEnums = new Set<string>();
  const enums = collectModuleEnums(ast.program, unsafeEnums);
  traverse(ast, {
    VariableDeclarator(path) {
      const declaration = path.parentPath;
      if (
        !declaration.isVariableDeclaration() ||
        !isModuleLevel(declaration.parentPath) ||
        !types.isIdentifier(path.node.id)
      )
        return;
      const name = path.node.id.name;
      const binding = path.scope.getBinding(name);
      const isExported = declaration.parentPath?.isExportNamedDeclaration() ?? false;
      const constant =
        declaration.node.kind === "const" && path.node.init
          ? getModuleConstant(path.node.init, isExported, binding)
          : null;
      if (constant) constants.set(name, constant);
      if (path.node.id.loc)
        declarations.set(
          name,
          getModuleDeclaration(path, declaration.node.kind, binding, path.node.id.loc),
        );
    },
    ImportDeclaration(path) {
      for (const specifier of path.node.specifiers) {
        const localName = specifier.local.name;
        const references = path.scope.getBinding(localName)?.referencePaths ?? [];
        if (references.some(isMemberWrite)) importUses.set(localName, "written");
        if (references.length > 0 && references.every(isStateValueReference))
          importUses.set(localName, "state");
        const isNamespace = types.isImportNamespaceSpecifier(specifier);
        if (isNamespace && path.node.source.loc) namespaceSources.push(path.node.source.loc);
        if (isNamespace || !specifier.local.loc) continue;
        specifiers.push({ localName, loc: specifier.local.loc });
        referencesByName.set(localName, references);
      }
    },
    ExportNamedDeclaration(path) {
      if (path.node.source?.loc) reexportSources.push(path.node.source.loc);
    },
    ExportAllDeclaration(path) {
      if (path.node.source.loc) reexportSources.push(path.node.source.loc);
    },
    TSEnumDeclaration(path) {
      if (!isModuleLevel(path.parentPath)) unsafeEnums.add(path.node.id.name);
    },
    Identifier(path) {
      const value = enums.get(path.node.name);
      if (
        !value ||
        isTypePosition(path) ||
        !path.isReferencedIdentifier() ||
        path.scope.hasBinding(path.node.name)
      )
        return;
      if (!isReadOfPrimitive(path, [value], [])) unsafeEnums.add(path.node.name);
    },
  });
  for (const [name, value] of enums) if (!unsafeEnums.has(name)) constants.set(name, value);
  return {
    declarations,
    constants,
    importUses,
    importedNames: {
      specifiers,
      namespaceSources,
      reexportSources,
      isReadOnly: (localName, value) =>
        isOnlyReadOfPrimitives(referencesByName.get(localName) ?? [], value),
    },
  };
};
