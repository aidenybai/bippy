import { traverse, types } from "@babel/core";
import type { NodePath } from "@babel/core";
import type { SymbolicValue } from "./types";

export interface ModuleConstantLoader {
  (constantName: string): SymbolicValue | null;
}

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
  "clear",
  "add",
]);

const getRootName = (node: types.Node): string | null => {
  if (types.isIdentifier(node)) return node.name;
  if (types.isMemberExpression(node) || types.isOptionalMemberExpression(node))
    return getRootName(node.object);
  return null;
};

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

export const createModuleConstantLoader = (ast: types.File): ModuleConstantLoader => {
  const initializers = new Map<string, types.Node>();
  const mutatedNames = new Set<string>();
  const markMutated = (node: types.Node): void => {
    const rootName = getRootName(node);
    if (rootName !== null && !types.isIdentifier(node)) mutatedNames.add(rootName);
  };
  traverse(ast, {
    VariableDeclarator(path) {
      const declaration = path.parentPath;
      const isModuleConstant =
        declaration.isVariableDeclaration() &&
        declaration.node.kind === "const" &&
        isModuleLevel(declaration.parentPath) &&
        types.isIdentifier(path.node.id) &&
        path.node.init !== null &&
        path.node.init !== undefined;
      if (isModuleConstant && types.isIdentifier(path.node.id) && path.node.init)
        initializers.set(path.node.id.name, path.node.init);
    },
    AssignmentExpression(path) {
      markMutated(path.node.left);
    },
    UpdateExpression(path) {
      markMutated(path.node.argument);
    },
    UnaryExpression(path) {
      if (path.node.operator === "delete") markMutated(path.node.argument);
    },
    CallExpression(path) {
      const { callee } = path.node;
      const [receiver] = path.node.arguments;
      const isMutatingMethod =
        types.isMemberExpression(callee) &&
        types.isIdentifier(callee.property) &&
        MUTATING_METHODS.has(callee.property.name);
      if (isMutatingMethod) markMutated(callee);
      const isObjectAssign =
        types.isMemberExpression(callee) &&
        types.isIdentifier(callee.object, { name: "Object" }) &&
        types.isIdentifier(callee.property, { name: "assign" });
      if (isObjectAssign && receiver && types.isIdentifier(receiver))
        mutatedNames.add(receiver.name);
    },
  });
  const constantsByName = new Map<string, SymbolicValue | null>();
  return (constantName) => {
    if (!constantsByName.has(constantName)) {
      const initializer = initializers.get(constantName);
      constantsByName.set(
        constantName,
        initializer && !mutatedNames.has(constantName) ? toSymbolicValue(initializer) : null,
      );
    }
    return constantsByName.get(constantName) ?? null;
  };
};
