import { traverse, types } from "@babel/core";
import type { NodePath } from "@babel/core";
import { GeneratedSource } from "../react-compiler/HIR/HIR";
import type { SourceLocation } from "../react-compiler/HIR/HIR";
import type { PrimitiveValue, SymbolicValue } from "./types";

export interface ModuleConstantLoader {
  (constantName: string): SymbolicValue | null;
}

export interface ModuleVariable {
  initial: SymbolicValue | null;
  loc: SourceLocation;
}

export interface ModuleVariableLoader {
  (variableName: string): ModuleVariable | null;
}

export interface ModuleDeclaration extends ModuleVariable {
  isWritten: boolean;
}

export interface ModuleDeclarationLoader {
  (variableName: string): ModuleDeclaration | null;
}

export interface WrittenImportLoader {
  (localName: string): boolean;
}

const COLLECTION_NAMES = new Map<string, "Set" | "Map">([
  ["Set", "Set"],
  ["Map", "Map"],
]);

const isModuleLevel = (path: NodePath | null): boolean =>
  path !== null &&
  (path.isProgram() || (path.isExportNamedDeclaration() && isModuleLevel(path.parentPath)));

const allOrNone = <Item>(items: Array<Item | null>): Item[] | null => {
  const present = items.filter((item): item is Item => item !== null);
  return present.length === items.length ? present : null;
};

const toSymbolicValue = (node: types.Node): SymbolicValue | null => {
  if (types.isStringLiteral(node) || types.isNumericLiteral(node) || types.isBooleanLiteral(node))
    return { kind: "Primitive", value: node.value };
  if (types.isNullLiteral(node)) return { kind: "Primitive", value: null };
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
    const collection = COLLECTION_NAMES.get(node.callee.name);
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
  const { parentPath } = path;
  if (!parentPath) return false;
  return (
    parentPath.isAssignmentExpression({ left: path.node }) ||
    parentPath.isUpdateExpression() ||
    parentPath.isUnaryExpression({ operator: "delete" })
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
  const { callee } = call;
  return (
    types.isMemberExpression(callee) &&
    types.isIdentifier(callee.object, { name: "Object" }) &&
    types.isIdentifier(callee.property) &&
    OBJECT_READS.has(callee.property.name) &&
    values.every((value) => isLiteralList(value) || isLiteralTable(value))
  );
};

const isReadOfPrimitive = (
  path: NodePath,
  values: SymbolicValue[],
  receiverValues: SymbolicValue[],
): boolean => {
  const { parentPath } = path;
  if (isListRead(path, values) || isObjectRead(path, values)) return true;
  const member = parentPath?.node;
  const isMemberObject =
    (types.isMemberExpression(member) || types.isOptionalMemberExpression(member)) &&
    member.object === path.node;
  if (parentPath && isMemberObject)
    return isReadOfPrimitive(
      parentPath,
      values.flatMap((value) => getMemberValues(value, member)),
      values,
    );
  if (!values.every(isPrimitive) || isWriteTarget(path)) return false;
  const isCallee = parentPath?.isCallExpression({ callee: path.node }) ?? false;
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
  const { node, parentPath } = path;
  const isMember = types.isMemberExpression(node) || types.isOptionalMemberExpression(node);
  return (
    isMember &&
    !node.computed &&
    types.isIdentifier(node.property) &&
    MUTATING_METHODS.has(node.property.name) &&
    (parentPath?.isCallExpression({ callee: node }) === true ||
      parentPath?.isOptionalCallExpression({ callee: node }) === true)
  );
};

const isMemberWrite = (path: NodePath): boolean => {
  const { parentPath } = path;
  const member = parentPath?.node;
  const isMemberObject =
    (types.isMemberExpression(member) || types.isOptionalMemberExpression(member)) &&
    member.object === path.node;
  return (
    parentPath !== null &&
    isMemberObject &&
    (isWriteTarget(parentPath) || isMutatingMethodCallee(parentPath) || isMemberWrite(parentPath))
  );
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
  const { callee } = call.node;
  if (!types.isIdentifier(callee)) return false;
  const declarator = call.scope.getBinding(callee.name)?.path;
  if (!declarator?.isVariableDeclarator() || !types.isArrayPattern(declarator.node.id))
    return false;
  const { init } = declarator.node;
  const hookCallee = types.isCallExpression(init) ? init.callee : null;
  const hook = types.isMemberExpression(hookCallee) ? hookCallee.property : hookCallee;
  const [stateElement, setterElement] = declarator.node.id.elements;
  if (
    !types.isIdentifier(hook, { name: "useState" }) ||
    !types.isIdentifier(setterElement, { name: callee.name }) ||
    !types.isIdentifier(stateElement)
  )
    return false;
  const stateBinding = declarator.scope.getBinding(stateElement.name);
  return stateBinding !== undefined && !stateBinding.referencePaths.some(isMemberWrite);
};

const isStateValueReference = (path: NodePath): boolean => {
  const { parentPath } = path;
  if (!parentPath) return false;
  if (parentPath.isSpreadElement() || parentPath.isReturnStatement()) return true;
  if (parentPath.isArrowFunctionExpression()) return parentPath.node.body === path.node;
  if (parentPath.isConditionalExpression())
    return parentPath.node.test !== path.node && isStateValueReference(parentPath);
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

export const createModuleDeclarationLoader = (ast: types.File): ModuleDeclarationLoader => {
  const declarations = new Map<string, ModuleDeclaration>();
  traverse(ast, {
    VariableDeclarator(path) {
      const declaration = path.parentPath;
      const { id, init } = path.node;
      if (
        !declaration.isVariableDeclaration() ||
        !isModuleLevel(declaration.parentPath) ||
        !types.isIdentifier(id) ||
        !id.loc
      )
        return;
      const binding = path.scope.getBinding(id.name);
      const value = init ? toSymbolicValue(init) : null;
      const isWritten =
        binding !== undefined &&
        (binding.constantViolations.length > 0 ||
          binding.referencePaths.some(isMemberWrite) ||
          (value !== null && isReadThroughState(binding.referencePaths, value)));
      declarations.set(id.name, {
        initial: init ? value : { kind: "Primitive", value: undefined },
        loc: id.loc,
        isWritten,
      });
    },
  });
  return (variableName) => declarations.get(variableName) ?? null;
};

export const createModuleVariableLoader = (ast: types.File): ModuleVariableLoader => {
  const loadDeclaration = createModuleDeclarationLoader(ast);
  return (variableName) => {
    const declaration = loadDeclaration(variableName);
    return declaration?.isWritten ? declaration : null;
  };
};

export const createWrittenImportLoader = (ast: types.File): WrittenImportLoader => {
  const writtenImports = new Set<string>();
  traverse(ast, {
    ImportDeclaration(path) {
      for (const specifier of path.node.specifiers) {
        const binding = path.scope.getBinding(specifier.local.name);
        if (binding?.referencePaths.some(isMemberWrite)) writtenImports.add(specifier.local.name);
      }
    },
  });
  return (localName) => writtenImports.has(localName);
};

export const createModuleConstantLoader = (ast: types.File): ModuleConstantLoader => {
  const constants = new Map<string, SymbolicValue>();
  const enums = new Map<string, SymbolicValue>();
  const unsafeEnums = new Set<string>();
  traverse(ast, {
    VariableDeclarator(path) {
      const declaration = path.parentPath;
      if (
        !declaration.isVariableDeclaration() ||
        declaration.node.kind !== "const" ||
        !isModuleLevel(declaration.parentPath) ||
        !types.isIdentifier(path.node.id) ||
        !path.node.init
      )
        return;
      const value = toSymbolicValue(path.node.init);
      if (!value) return;
      const isExported = declaration.parentPath?.isExportNamedDeclaration() ?? false;
      const binding = path.scope.getBinding(path.node.id.name);
      const isUnchanged =
        isPrimitive(value) ||
        (!isExported &&
          binding !== undefined &&
          binding.constantViolations.length === 0 &&
          !isReadThroughState(binding.referencePaths, value) &&
          binding.referencePaths.every(
            (reference) =>
              isStateValueReference(reference) || isReadOfPrimitive(reference, [value], []),
          ));
      if (isUnchanged) constants.set(path.node.id.name, value);
    },
    TSEnumDeclaration(path) {
      const { name } = path.node.id;
      const value = isModuleLevel(path.parentPath) ? getEnumObject(path.node) : null;
      if (value && !enums.has(name)) enums.set(name, value);
      if (!value || enums.get(name) !== value) unsafeEnums.add(name);
    },
  });
  traverse(ast, {
    Identifier(path) {
      const { name } = path.node;
      const value = enums.get(name);
      const isTypePosition =
        path.parentPath.isTSTypeReference() ||
        path.parentPath.isTSQualifiedName() ||
        path.parentPath.isTSEnumDeclaration({ id: path.node });
      if (!value || isTypePosition || !path.isReferencedIdentifier() || path.scope.hasBinding(name))
        return;
      if (!isReadOfPrimitive(path, [value], [])) unsafeEnums.add(name);
    },
  });
  for (const [name, value] of enums) if (!unsafeEnums.has(name)) constants.set(name, value);
  return (constantName) => constants.get(constantName) ?? null;
};
