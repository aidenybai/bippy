import { traverse, types } from "@babel/core";
import type { NodePath } from "@babel/core";
import type { SymbolicValue } from "./types";

export interface ModuleConstantLoader {
  (constantName: string): SymbolicValue | null;
}

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

const isReadOfPrimitive = (
  path: NodePath,
  values: SymbolicValue[],
  receiverValues: SymbolicValue[],
): boolean => {
  const { parentPath } = path;
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

export const createModuleConstantLoader = (ast: types.File): ModuleConstantLoader => {
  const constants = new Map<string, SymbolicValue>();
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
          binding.referencePaths.every((reference) => isReadOfPrimitive(reference, [value], [])));
      if (isUnchanged) constants.set(path.node.id.name, value);
    },
  });
  return (constantName) => constants.get(constantName) ?? null;
};
