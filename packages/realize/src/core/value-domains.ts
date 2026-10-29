import { dedupeAbstractValues } from "./abstract-values";
import { EQUALITY_OPERATORS } from "./comparison-operators";
import type { AbstractValue, BindingValue, Domain, SymbolicValue } from "./types";
import { getTruthiness } from "./utils/get-truthiness";
import { getValuePlace } from "./utils/get-value-place";
import type { PlaceMap } from "./utils/place-map";

export type Places = PlaceMap<AbstractValue[]>;

const COMPARISON_OPERATORS = new Set([...EQUALITY_OPERATORS, "<", "<=", ">", ">="]);
const UNRESOLVED: Domain = { kind: "Unknown", reason: "unresolved" };
const BOOLEAN_CASES: AbstractValue[] = [
  { kind: "Literal", value: true },
  { kind: "Literal", value: false },
];

const toCases = (cases: AbstractValue[]): Domain => ({
  kind: "Cases",
  cases: dedupeAbstractValues(cases),
  origin: "call-sites",
});

const getBindingDomain = (value: BindingValue, places: Places): Domain => {
  const known = places.get(getValuePlace(value));
  if (known) return toCases(known);
  return value.path.length === 0 ? value.binding.domain : UNRESOLVED;
};

const mergeDomains = (left: Domain, right: Domain): Domain => {
  if (left.kind === "Cases" && right.kind === "Cases")
    return toCases([...left.cases, ...right.cases]);
  if (left.kind === "Unknown") return left;
  if (right.kind === "Unknown") return right;
  return left.kind === "Opaque" ? left : right;
};

const negateDomain = (domain: Domain): Domain => {
  if (domain.kind !== "Cases") return toCases(BOOLEAN_CASES);
  const truthiness = domain.cases.map(getTruthiness);
  if (truthiness.includes("either")) return toCases(BOOLEAN_CASES);
  return toCases(truthiness.map((outcome) => ({ kind: "Literal", value: outcome === "falsy" })));
};

export const getValueDomain = (value: SymbolicValue, places: Places): Domain => {
  switch (value.kind) {
    case "Primitive":
      return toCases([{ kind: "Literal", value: value.value }]);
    case "Binding":
      return getBindingDomain(value, places);
    case "Conditional":
      return mergeDomains(
        getValueDomain(value.consequent, places),
        getValueDomain(value.alternate, places),
      );
    case "UnaryExpression":
      return value.operator === "!"
        ? negateDomain(getValueDomain(value.value, places))
        : UNRESOLVED;
    case "BinaryExpression":
      return COMPARISON_OPERATORS.has(value.operator) ? toCases(BOOLEAN_CASES) : UNRESOLVED;
    case "ObjectExpression":
      return { kind: "Opaque", typeText: "object" };
    case "ArrayExpression":
    case "ArrayMap":
      return { kind: "Opaque", typeText: "array" };
    case "JsxExpression":
    case "JsxFragment":
    case "JSXText":
      return { kind: "Opaque", typeText: "element" };
    case "Function":
    case "Setter":
    case "Dispatch":
    case "Bound":
      return { kind: "Opaque", typeText: "function" };
    default:
      return UNRESOLVED;
  }
};
