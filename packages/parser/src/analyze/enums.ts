import type { TSEnumDeclaration, TSEnumMemberName } from "@oxc-project/types";
import type { EvaluationContext, Interpreter } from "./interpreter.js";
import { createScope, declareVariable } from "./scope.js";
import { literal, object, type ObjectValue, type StaticValue, unknown } from "./values.js";

const getMemberName = (name: TSEnumMemberName): string | null => {
  switch (name.type) {
    case "Identifier":
      return name.name;
    case "Literal":
      return name.value;
    case "TemplateLiteral":
      return name.expressions.length === 0 ? (name.quasis[0]?.value.cooked ?? null) : null;
  }
};

/**
 * A TypeScript enum compiles to an object. Members without an initializer
 * count up from the previous numeric member, numeric members also get a
 * reverse mapping from value to name, and initializers may refer to earlier
 * members by their bare name.
 */
export const evaluateEnum = (
  interpreter: Interpreter,
  declaration: TSEnumDeclaration,
  context: EvaluationContext,
): ObjectValue => {
  const members = object();
  const memberScope = createScope(context.scope);
  const memberContext: EvaluationContext = { ...context, scope: memberScope };
  let nextNumber: number | null = 0;
  for (const member of declaration.body.members) {
    const name = getMemberName(member.id);
    if (name === null) continue;
    let value: StaticValue;
    if (member.initializer) {
      value = interpreter.evaluateExpression(member.initializer, memberContext);
    } else if (nextNumber !== null) {
      value = literal(nextNumber);
    } else {
      value = unknown(`enum member ${declaration.id.name}.${name} follows a computed member`);
    }
    const numericValue =
      value.kind === "literal" && typeof value.value === "number" ? value.value : null;
    nextNumber = numericValue === null ? null : numericValue + 1;
    members.properties.set(name, value);
    if (numericValue !== null) members.properties.set(String(numericValue), literal(name));
    declareVariable(memberScope, name, value);
  }
  return members;
};
