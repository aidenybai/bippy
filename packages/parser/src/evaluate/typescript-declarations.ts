import type {
  Statement,
  TSEnumDeclaration,
  TSEnumMemberName,
  TSGlobalDeclaration,
  TSModuleDeclaration,
} from "oxc-parser";
import type { StaticObjectEntry, StaticValue } from "../types.js";
import type { EvaluationContext } from "./context.js";
import { withScope } from "./context.js";
import type { Interpreter } from "./interpreter.js";
import { createScope, declareInScope } from "./scope.js";
import { objectValue, primitiveValue, unknownValue } from "./values.js";

export type TypeScriptDeclaration = TSEnumDeclaration | TSModuleDeclaration | TSGlobalDeclaration;

/** The binding an enum or namespace creates at runtime; `declare`d and `global` blocks create none. */
export const getTypeScriptDeclarationName = (node: TypeScriptDeclaration): string | null => {
  if (node.declare || node.id.type !== "Identifier") return null;
  if (node.type === "TSModuleDeclaration" && node.kind === "global") return null;
  return node.id.name;
};

const getEnumMemberName = (
  interpreter: Interpreter,
  id: TSEnumMemberName,
  context: EvaluationContext,
): string | null => {
  if (id.type === "Identifier") return id.name;
  if (id.type === "Literal") return id.value;
  const evaluated = interpreter.evaluateExpression(id, context);
  return evaluated.kind === "primitive" && typeof evaluated.value === "string"
    ? evaluated.value
    : null;
};

/**
 * `enum E { A, B = 5, C }` compiles to an object with the members and, for
 * numeric members, the reverse mapping (`E[5] === "B"`). Initializers may
 * reference earlier members by bare name.
 */
export const evaluateEnumDeclaration = (
  interpreter: Interpreter,
  node: TSEnumDeclaration,
  context: EvaluationContext,
): StaticValue => {
  const memberContext = withScope(context, createScope(context.scope));
  const entries: StaticObjectEntry[] = [];
  let previous: StaticValue | null = null;
  for (const member of node.body.members) {
    const key = getEnumMemberName(interpreter, member.id, memberContext);
    if (key === null) {
      return unknownValue(
        `enum "${node.id.name}" has a computed member name`,
        interpreter.locate(context.module, member),
      );
    }
    let value: StaticValue;
    if (member.initializer) {
      value = interpreter.evaluateExpression(member.initializer, memberContext, key);
    } else if (previous === null) {
      value = primitiveValue(0);
    } else if (previous.kind === "primitive" && typeof previous.value === "number") {
      value = primitiveValue(previous.value + 1);
    } else {
      value = unknownValue(
        `enum member "${key}" follows a non-numeric member without an initializer`,
        interpreter.locate(context.module, member),
      );
    }
    entries.push({ kind: "property", key, value });
    if (value.kind === "primitive" && typeof value.value === "number") {
      entries.push({ kind: "property", key: String(value.value), value: primitiveValue(key) });
    }
    declareInScope(memberContext.scope, key, value);
    previous = value;
  }
  return objectValue(entries);
};

const getDeclaredNames = (statement: Statement): string[] => {
  switch (statement.type) {
    case "VariableDeclaration":
      return statement.declarations.flatMap((declarator) =>
        declarator.id.type === "Identifier" ? [declarator.id.name] : [],
      );
    case "FunctionDeclaration":
    case "ClassDeclaration":
      return statement.id ? [statement.id.name] : [];
    case "TSEnumDeclaration":
      return [statement.id.name];
    case "TSModuleDeclaration":
      return statement.id.type === "Identifier" ? [statement.id.name] : [];
    default:
      return [];
  }
};

/**
 * `namespace N { export const a = 1; const hidden = 2 }` runs its body once and
 * exposes only the `export`ed bindings as properties of `N`.
 */
export const evaluateNamespaceDeclaration = (
  interpreter: Interpreter,
  node: TSModuleDeclaration | TSGlobalDeclaration,
  context: EvaluationContext,
): StaticValue => {
  if (!node.body) {
    return unknownValue(
      "only block-bodied namespaces are analyzed",
      interpreter.locate(context.module, node),
    );
  }
  const exportedNames: string[] = [];
  const statements: Statement[] = [];
  for (const statement of node.body.body) {
    if (statement.type === "ExportNamedDeclaration" && statement.declaration) {
      exportedNames.push(...getDeclaredNames(statement.declaration));
      statements.push(statement.declaration);
    } else {
      statements.push(statement);
    }
  }
  const scope = createScope(context.scope);
  interpreter.evaluateBlock(statements, withScope(context, scope), false);
  return objectValue(
    exportedNames.flatMap((exportedName) => {
      const value = scope.bindings.get(exportedName);
      return value ? [{ kind: "property", key: exportedName, value }] : [];
    }),
  );
};

export const evaluateTypeScriptDeclaration = (
  interpreter: Interpreter,
  node: TypeScriptDeclaration,
  context: EvaluationContext,
): StaticValue =>
  node.type === "TSEnumDeclaration"
    ? evaluateEnumDeclaration(interpreter, node, context)
    : evaluateNamespaceDeclaration(interpreter, node, context);
