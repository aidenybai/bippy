import type {
  JSXAttributeItem,
  JSXAttributeValue,
  JSXChild,
  JSXElement,
  JSXElementName,
  JSXFragment,
  Span,
} from "@oxc-project/types";
import { getJsxNameChain } from "../module/ast.js";
import type { EvaluationContext, Interpreter } from "./interpreter.js";
import { JSX_NAMED_ENTITIES } from "./jsx-entities.js";
import {
  array,
  builtin,
  type ElementValue,
  literal,
  mergeObjects,
  object,
  type ObjectValue,
  type StaticValue,
  TRUE,
  UNDEFINED,
  unknown,
} from "./values.js";

const ENTITY_PATTERN = /&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g;

/** Decodes the XHTML entities the JSX grammar permits in text and attributes. */
export const decodeJsxEntities = (raw: string): string =>
  raw.replace(ENTITY_PATTERN, (match, body: string) => {
    if (body[0] === "#") {
      const codePoint =
        body[1] === "x" || body[1] === "X" ? Number.parseInt(body.slice(2), 16) : Number(body.slice(1));
      return Number.isFinite(codePoint) && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : match;
    }
    return JSX_NAMED_ENTITIES[body] ?? match;
  });

/**
 * Whitespace rules applied by every JSX compiler (Babel's
 * `cleanJSXElementLiteralChild`): lines are trimmed at newline boundaries,
 * tabs become spaces, blank lines vanish and remaining lines are joined
 * with a single space. Returns `null` when nothing is left to render.
 */
export const cleanJsxText = (rawText: string): string | null => {
  const lines = decodeJsxEntities(rawText).split(/\r\n|\n|\r/);
  let lastNonEmptyLine = 0;
  lines.forEach((line, index) => {
    if (/[^ \t]/.test(line)) lastNonEmptyLine = index;
  });
  let result = "";
  lines.forEach((line, index) => {
    let trimmed = line.replace(/\t/g, " ");
    if (index !== 0) trimmed = trimmed.replace(/^ +/, "");
    if (index !== lines.length - 1) trimmed = trimmed.replace(/ +$/, "");
    if (!trimmed) return;
    result += index === lastNonEmptyLine ? trimmed : `${trimmed} `;
  });
  return result || null;
};

const isHostTagName = (name: string): boolean => {
  const firstCharacter = name.charCodeAt(0);
  return (firstCharacter >= 97 && firstCharacter <= 122) || name.includes("-");
};

/**
 * Lowercase and dashed tags are host elements; everything else is looked up
 * as a value, including member chains such as `Dialog.Trigger`.
 */
const evaluateElementType = (
  interpreter: Interpreter,
  name: JSXElementName,
  context: EvaluationContext,
): StaticValue => {
  const chain = getJsxNameChain(name);
  if (!chain) return unknown("jsx element name");
  if (name.type === "JSXNamespacedName") return literal(chain[0]);
  if (chain.length === 1 && isHostTagName(chain[0])) return literal(chain[0]);
  return interpreter.evaluateChain(chain, name, context);
};

const evaluateAttributes = (
  interpreter: Interpreter,
  attributes: JSXAttributeItem[],
  context: EvaluationContext,
): { props: ObjectValue; key: StaticValue | null } => {
  const props = object();
  let key: StaticValue | null = null;
  for (const attribute of attributes) {
    if (attribute.type === "JSXSpreadAttribute") {
      const spread = interpreter.evaluateExpression(attribute.argument, context);
      if (spread.kind === "object") {
        mergeObjects(props, spread);
        const spreadKey = spread.properties.get("key");
        if (spreadKey && key === null) key = spreadKey;
      } else {
        props.hasUnknownSpread = true;
      }
      continue;
    }
    const attributeName =
      attribute.name.type === "JSXIdentifier"
        ? attribute.name.name
        : `${attribute.name.namespace.name}:${attribute.name.name.name}`;
    const value = evaluateAttributeValue(interpreter, attribute.value, context);
    if (attributeName === "key") key = value;
    else props.properties.set(attributeName, value);
  }
  props.properties.delete("key");
  return { props, key };
};

const evaluateAttributeValue = (
  interpreter: Interpreter,
  value: JSXAttributeValue | null,
  context: EvaluationContext,
): StaticValue => {
  if (value === null) return TRUE;
  switch (value.type) {
    case "Literal":
      return literal(decodeJsxEntities(value.value));
    case "JSXExpressionContainer":
      return value.expression.type === "JSXEmptyExpression"
        ? UNDEFINED
        : interpreter.evaluateExpression(value.expression, context);
    case "JSXElement":
      return evaluateJsxElement(interpreter, value, context);
    case "JSXFragment":
      return evaluateJsxFragment(interpreter, value, context);
  }
};

/**
 * Builds the `children` prop the way the JSX transform does: text is
 * whitespace-cleaned, empty expressions are dropped, a single child stays
 * unwrapped and several children form an array.
 */
export const evaluateJsxChildren = (
  interpreter: Interpreter,
  children: JSXChild[],
  context: EvaluationContext,
): StaticValue | null => {
  const values: StaticValue[] = [];
  for (const child of children) {
    switch (child.type) {
      case "JSXText": {
        const cleaned = cleanJsxText(child.value);
        if (cleaned !== null) values.push(literal(cleaned));
        break;
      }
      case "JSXExpressionContainer":
        if (child.expression.type !== "JSXEmptyExpression") {
          values.push(interpreter.evaluateExpression(child.expression, context));
        }
        break;
      case "JSXSpreadChild":
        values.push(interpreter.evaluateExpression(child.expression, context));
        break;
      case "JSXElement":
        values.push(evaluateJsxElement(interpreter, child, context));
        break;
      case "JSXFragment":
        values.push(evaluateJsxFragment(interpreter, child, context));
        break;
    }
  }
  if (values.length === 0) return null;
  return values.length === 1 ? values[0] : array(values);
};

export const createElementValue = (
  interpreter: Interpreter,
  type: StaticValue,
  props: ObjectValue,
  key: StaticValue | null,
  span: Span,
  context: EvaluationContext,
): ElementValue => ({
  kind: "element",
  type,
  key,
  props,
  location: interpreter.getLocation(context.module, span),
  owner: context.owner,
});

export const evaluateJsxElement = (
  interpreter: Interpreter,
  node: JSXElement,
  context: EvaluationContext,
): ElementValue => {
  const type = evaluateElementType(interpreter, node.openingElement.name, context);
  const { props, key } = evaluateAttributes(interpreter, node.openingElement.attributes, context);
  const children = evaluateJsxChildren(interpreter, node.children, context);
  if (children !== null) props.properties.set("children", children);
  return createElementValue(interpreter, type, props, key, node, context);
};

export const evaluateJsxFragment = (
  interpreter: Interpreter,
  node: JSXFragment,
  context: EvaluationContext,
): ElementValue => {
  const props = object();
  const children = evaluateJsxChildren(interpreter, node.children, context);
  if (children !== null) props.properties.set("children", children);
  return createElementValue(interpreter, builtin("Fragment"), props, null, node, context);
};
