import { relative } from "node:path";
import { getBranchKey } from "../core/control-flow";
import { formatLine } from "../core/format";
import { findRegions } from "../core/regions";
import type { RegionBranches } from "../core/regions";
import type {
  AbstractValue,
  AnalyzedComponent,
  Binding,
  BindingPlace,
  ConditionalValue,
  Handler,
  PrimitiveValue,
  SymbolicValue,
} from "../core/types";
import { getPlaceKey } from "../core/utils/get-place-key";
import { getTestExpression } from "../core/utils/get-test-expression";
import { getValueKey } from "../core/utils/get-value-key";
import { createSourceReader } from "./source-text";
import { collectTriggerLabels } from "./trigger-labels";

export interface TlaOptions {
  rootDirectory: string;
  moduleName: string;
}

export interface TlaSpec {
  moduleName: string;
  source: string;
  config: string;
  branchKeys: string[];
  regionCount: number;
}

type ValueType = "string" | "number" | "boolean" | "object";

type PlaceRole = "constant" | "state" | "external";

interface TlaExpression {
  text: string;
  types: ReadonlySet<ValueType>;
  isNullable: boolean;
}

interface TlaVariable {
  name: string;
  place: BindingPlace;
  binding: Binding;
  role: PlaceRole;
  domain: string;
  types: ReadonlySet<ValueType>;
  isNullable: boolean;
}

interface TlaBranch {
  name: string;
  key: string;
  location: string;
  test: SymbolicValue;
}

interface Scope {
  namesByPlace: Map<string, string>;
  variablesByPlace: Map<string, TlaVariable>;
}

interface SpecContext {
  allocateName: (base: string) => string;
  variables: TlaVariable[];
  stateScope: Scope;
  stepLines: string[];
}

const MAX_INTEGER = 2 ** 31 - 1;
const MAX_ALIAS_DEPTH = 32;
const PRINTABLE_STRING = /^[ !#-[\]-~]*$/;
const NULLISH_SET = "{Null, Undefined}";
const BOOLEAN_TYPES: ReadonlySet<ValueType> = new Set(["boolean"]);
const NUMBER_TYPES: ReadonlySet<ValueType> = new Set(["number"]);
const STRING_TYPES: ReadonlySet<ValueType> = new Set(["string"]);
const OBJECT_TYPES: ReadonlySet<ValueType> = new Set(["object"]);
const NO_TYPES: ReadonlySet<ValueType> = new Set();
const RESERVED_NAMES = ["Null", "Undefined", "Init", "Next", "Screen", "Settled", "vars", "fresh"];
const RELATIONAL_OPERATORS = new Map([
  ["<", "<"],
  ["<=", "=<"],
  [">", ">"],
  [">=", ">="],
]);
const ARITHMETIC_OPERATORS = new Set(["+", "-", "*"]);

const createNameAllocator = (): ((base: string) => string) => {
  const usedNames = new Set(RESERVED_NAMES);
  return (base) => {
    const identifier = base.replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
    const startName = /^[A-Za-z]/.test(identifier) ? identifier : `v_${identifier}`;
    let name = startName;
    for (let suffix = 2; usedNames.has(name); suffix++) name = `${startName}_${suffix}`;
    usedNames.add(name);
    return name;
  };
};

const encodePrimitive = (value: PrimitiveValue): TlaExpression | null => {
  if (value === null) return { text: "Null", types: NO_TYPES, isNullable: true };
  if (value === undefined) return { text: "Undefined", types: NO_TYPES, isNullable: true };
  if (typeof value === "boolean")
    return { text: value ? "TRUE" : "FALSE", types: BOOLEAN_TYPES, isNullable: false };
  if (typeof value === "number")
    return Number.isInteger(value) && Math.abs(value) <= MAX_INTEGER
      ? { text: String(value), types: NUMBER_TYPES, isNullable: false }
      : null;
  return PRINTABLE_STRING.test(value)
    ? { text: `"${value}"`, types: STRING_TYPES, isNullable: false }
    : null;
};

const encodeAbstractValue = (
  value: AbstractValue,
  getObjectName: (typeText: string) => string,
): TlaExpression | null => {
  if (value.kind === "Literal") return encodePrimitive(value.value);
  if (value.kind === "Type" && value.primitive === null)
    return { text: getObjectName(value.text), types: OBJECT_TYPES, isNullable: false };
  return null;
};

const getPrimitiveTypes = (types: ReadonlySet<ValueType>): ValueType[] =>
  [...types].filter((type) => type !== "object");

const toBoolean = (text: string): TlaExpression => ({
  text,
  types: BOOLEAN_TYPES,
  isNullable: false,
});

const isNumeric = (expression: TlaExpression): boolean =>
  !expression.isNullable && expression.types.size === 1 && expression.types.has("number");

const isNullishLiteral = (value: SymbolicValue): boolean =>
  value.kind === "Primitive" && (value.value === null || value.value === undefined);

const wrap = (text: string): string => (/^[\w"]+$|^\(.*\)$/.test(text) ? text : `(${text})`);

const formatTruthy = (expression: TlaExpression): string | null => {
  const primitiveTypes = getPrimitiveTypes(expression.types);
  if (primitiveTypes.length > 1) return null;
  const isPlainBoolean = expression.types.size === 1 && !expression.isNullable;
  if (primitiveTypes[0] === "boolean")
    return isPlainBoolean ? expression.text : `(${expression.text} = TRUE)`;
  const falsyValues = [
    ...(primitiveTypes[0] === "string" ? ['""'] : []),
    ...(primitiveTypes[0] === "number" ? ["0"] : []),
    ...(expression.isNullable ? ["Null", "Undefined"] : []),
  ];
  return falsyValues.length === 0
    ? "TRUE"
    : `(${expression.text} \\notin {${falsyValues.join(", ")}})`;
};

const projectValue = (value: SymbolicValue, path: string[]): SymbolicValue | null => {
  if (path.length === 0) return value;
  if (value.kind === "Binding")
    return { kind: "Binding", binding: value.binding, path: [...value.path, ...path] };
  if (value.kind === "Conditional") {
    const consequent = projectValue(value.consequent, path);
    const alternate = projectValue(value.alternate, path);
    return consequent && alternate ? { ...value, consequent, alternate } : null;
  }
  if (value.kind !== "ObjectExpression") return null;
  const property = value.properties.findLast((innerProperty) => innerProperty.key === path[0]);
  if (property) return projectValue(property.value, path.slice(1));
  const spread = value.spreads.at(-1);
  return spread ? projectValue(spread, path) : { kind: "Primitive", value: undefined };
};

const translateEquality = (
  left: TlaExpression,
  right: TlaExpression,
  isNegated: boolean,
): TlaExpression | null => {
  const leftTypes = getPrimitiveTypes(left.types);
  const rightTypes = getPrimitiveTypes(right.types);
  if (leftTypes.length > 1 || rightTypes.length > 1) return null;
  const isMismatched =
    leftTypes.length === 1 && rightTypes.length === 1 && leftTypes[0] !== rightTypes[0];
  if (isMismatched && left.isNullable && right.isNullable) return null;
  if (isMismatched) return toBoolean(isNegated ? "TRUE" : "FALSE");
  return toBoolean(`(${left.text} ${isNegated ? "#" : "="} ${right.text})`);
};

const translateBinary = (
  value: Extract<SymbolicValue, { kind: "BinaryExpression" }>,
  scope: Scope,
  depth: number,
): TlaExpression | null => {
  const { operator } = value;
  const isLoose = operator === "==" || operator === "!=";
  const isNegated = operator === "!==" || operator === "!=";
  if (isLoose && (isNullishLiteral(value.left) || isNullishLiteral(value.right))) {
    const operand = translateValue(
      isNullishLiteral(value.left) ? value.right : value.left,
      scope,
      depth,
    );
    return operand
      ? toBoolean(`(${operand.text} ${isNegated ? "\\notin" : "\\in"} ${NULLISH_SET})`)
      : null;
  }
  const left = translateValue(value.left, scope, depth);
  const right = translateValue(value.right, scope, depth);
  if (!left || !right) return null;
  if (operator === "===" || operator === "!==") return translateEquality(left, right, isNegated);
  if (isLoose)
    return left.isNullable || right.isNullable ? null : translateEquality(left, right, isNegated);
  if (!isNumeric(left) || !isNumeric(right)) return null;
  const relational = RELATIONAL_OPERATORS.get(operator);
  if (relational) return toBoolean(`(${left.text} ${relational} ${right.text})`);
  return ARITHMETIC_OPERATORS.has(operator)
    ? { text: `(${left.text} ${operator} ${right.text})`, types: NUMBER_TYPES, isNullable: false }
    : null;
};

const translateValue = (value: SymbolicValue, scope: Scope, depth = 0): TlaExpression | null => {
  if (depth > MAX_ALIAS_DEPTH) return null;
  switch (value.kind) {
    case "Primitive":
      return encodePrimitive(value.value);
    case "Binding": {
      const placeKey = getPlaceKey({ bindingId: value.binding.id, path: value.path });
      const name = scope.namesByPlace.get(placeKey);
      const variable = scope.variablesByPlace.get(placeKey);
      if (name && variable)
        return { text: name, types: variable.types, isNullable: variable.isNullable };
      const aliased = value.binding.alias ? projectValue(value.binding.alias, value.path) : null;
      return aliased ? translateValue(aliased, scope, depth + 1) : null;
    }
    case "UnaryExpression": {
      const operand = translateValue(value.value, scope, depth + 1);
      if (!operand) return null;
      if (value.operator === "-" && isNumeric(operand))
        return { text: `(-${operand.text})`, types: NUMBER_TYPES, isNullable: false };
      const truthy = value.operator === "!" ? formatTruthy(operand) : null;
      return truthy === null ? null : toBoolean(`~${wrap(truthy)}`);
    }
    case "BinaryExpression":
      return translateBinary(value, scope, depth + 1);
    case "Conditional": {
      const test = translateValue(getTestExpression(value), scope, depth + 1);
      const truthy = test ? formatTruthy(test) : null;
      const consequent = translateValue(value.consequent, scope, depth + 1);
      const alternate = translateValue(value.alternate, scope, depth + 1);
      if (truthy === null || !consequent || !alternate) return null;
      return {
        text: `(IF ${truthy} THEN ${consequent.text} ELSE ${alternate.text})`,
        types: new Set([...consequent.types, ...alternate.types]),
        isNullable: consequent.isNullable || alternate.isNullable,
      };
    }
    default:
      return null;
  }
};

const translateCondition = (value: SymbolicValue, scope: Scope): string | null => {
  const expression = translateValue(value, scope);
  return expression ? formatTruthy(expression) : null;
};

const isConstantBinding = (
  binding: Binding,
  bindingsById: Map<number, Binding>,
  visitedIds: Set<number>,
): boolean => {
  if (binding.kind === "prop" || visitedIds.has(binding.id)) return true;
  if (binding.kind !== "call" && binding.kind !== "loop" && binding.kind !== "item") return false;
  visitedIds.add(binding.id);
  return binding.inputPlaces.every((place) => {
    const input = bindingsById.get(place.bindingId);
    return input !== undefined && isConstantBinding(input, bindingsById, visitedIds);
  });
};

const getPlaceRole = (binding: Binding, bindingsById: Map<number, Binding>): PlaceRole => {
  if (binding.kind === "state" || binding.kind === "reducer") return "state";
  return isConstantBinding(binding, bindingsById, new Set()) ? "constant" : "external";
};

const getBranchTestKey = (conditional: ConditionalValue): string =>
  `${getBranchKey(conditional.branch)}\0${getValueKey(getTestExpression(conditional))}`;

const collectBranches = (
  render: SymbolicValue,
  rootDirectory: string,
  allocateName: (base: string) => string,
): Map<string, TlaBranch> => {
  const branchesByTestKey = new Map<string, TlaBranch>();
  const visited = new WeakSet<SymbolicValue>();
  const visit = (value: SymbolicValue): void => {
    if (visited.has(value)) return;
    visited.add(value);
    if (value.kind === "JsxExpression" || value.kind === "JsxFragment")
      value.children.forEach(visit);
    if (value.kind !== "Conditional") return;
    const testKey = getBranchTestKey(value);
    if (!branchesByTestKey.has(testKey))
      branchesByTestKey.set(testKey, {
        name: allocateName(`Branch${branchesByTestKey.size + 1}`),
        key: getBranchKey(value.branch),
        location: `${relative(rootDirectory, value.branch.file)} ${formatLine(value.branch.loc)}`,
        test: getTestExpression(value),
      });
    visit(value.consequent);
    visit(value.alternate);
  };
  visit(render);
  return branchesByTestKey;
};

const formatRegion = (
  value: SymbolicValue,
  region: RegionBranches,
  branchesByTestKey: Map<string, TlaBranch>,
  branchIndexByKey: Map<string, number>,
): string | null => {
  if (value.kind === "JsxExpression" || value.kind === "JsxFragment") {
    const parts = value.children.flatMap(
      (child) => formatRegion(child, region, branchesByTestKey, branchIndexByKey) ?? [],
    );
    return parts.length === 0 ? null : parts.join(" \\o ");
  }
  if (value.kind !== "Conditional") return null;
  const key = getBranchKey(value.branch);
  const branch = branchesByTestKey.get(getBranchTestKey(value));
  const branchIndex = branchIndexByKey.get(key);
  if (!region.branchKeys.has(key) || !branch || branchIndex === undefined) return null;
  const formatArm = (outcome: string, arm: SymbolicValue): string => {
    const armText = formatRegion(arm, region, branchesByTestKey, branchIndexByKey);
    const outcomeText = `"${branchIndex + 1}${outcome},"`;
    return armText === null ? outcomeText : `${outcomeText} \\o ${armText}`;
  };
  return `(IF ${branch.name} THEN ${formatArm("+", value.consequent)} ELSE ${formatArm("-", value.alternate)})`;
};

const formatConjunction = (lines: string[], indent: string): string =>
  lines.length === 0 ? " TRUE" : lines.map((line) => `\n${indent}/\\ ${line}`).join("");

const isMountOnlyEffect = (handler: Handler): boolean =>
  handler.trigger.kind === "Effect" &&
  handler.trigger.dependencyPlaces !== null &&
  handler.trigger.dependencyPlaces.length === 0 &&
  !handler.updates.some((update) => update.isAsync);

const getActionName = (handler: Handler): string => {
  if (handler.trigger.kind === "Event") return `${handler.trigger.event}_${handler.id}`;
  if (handler.trigger.kind === "Effect") return `${handler.trigger.hookKind}_${handler.id}`;
  return `render_${handler.id}`;
};

const createVariables = (
  component: AnalyzedComponent,
  allocateName: (base: string) => string,
  getObjectName: (typeText: string) => string,
): TlaVariable[] => {
  const bindingsById = new Map(component.analysis.bindings.map((binding) => [binding.id, binding]));
  return [...component.report.places].flatMap(([place, values]) => {
    const binding = bindingsById.get(place.bindingId);
    const encodedValues = values.map((value) => encodeAbstractValue(value, getObjectName));
    const presentValues = encodedValues.flatMap((value) => value ?? []);
    if (!binding || presentValues.length === 0 || presentValues.length < encodedValues.length)
      return [];
    const types = new Set(presentValues.flatMap((value) => [...value.types]));
    if (getPrimitiveTypes(types).length > 1) return [];
    return {
      name: allocateName([binding.name, ...place.path].join("_")),
      place,
      binding,
      role: getPlaceRole(binding, bindingsById),
      domain: `{${[...new Set(presentValues.map((value) => value.text))].join(", ")}}`,
      types,
      isNullable: presentValues.some((value) => value.isNullable),
    };
  });
};

const createScope = (variables: TlaVariable[]): Scope => ({
  namesByPlace: new Map(variables.map((variable) => [getPlaceKey(variable.place), variable.name])),
  variablesByPlace: new Map(variables.map((variable) => [getPlaceKey(variable.place), variable])),
});

const formatInitialValue = (variable: TlaVariable, initScope: Scope): string => {
  const initial = variable.binding.initial
    ? projectValue(variable.binding.initial, variable.place.path)
    : null;
  const translated = initial ? translateValue(initial, initScope) : null;
  return translated
    ? `${variable.name} = ${translated.text}`
    : `${variable.name} \\in ${variable.domain}`;
};

const formatAction = (
  handler: Handler,
  label: string | undefined,
  context: SpecContext,
): { name: string; text: string } => {
  const name = context.allocateName(getActionName(handler));
  const scope: Scope = {
    namesByPlace: new Map(context.stateScope.namesByPlace),
    variablesByPlace: context.stateScope.variablesByPlace,
  };
  const choices: string[] = [];
  const definitions: string[] = [];
  const guessesByKey = new Map<string, string>();
  const formatGuard = (guard: SymbolicValue): string => {
    const translated = translateCondition(guard, scope);
    if (translated !== null) return translated;
    if (guard.kind === "UnaryExpression" && guard.operator === "!")
      return `~${formatGuard(guard.value)}`;
    const key = getValueKey(guard);
    const existing = guessesByKey.get(key);
    if (existing) return existing;
    const guess = context.allocateName(`${name}_unknown`);
    guessesByKey.set(key, guess);
    choices.push(`${guess} \\in BOOLEAN`);
    return guess;
  };
  const firstAsyncIndex = handler.updates.findIndex((update) => update.isAsync);
  const cutName = firstAsyncIndex === -1 ? null : context.allocateName(`${name}_settled`);
  if (cutName) choices.push(`${cutName} \\in ${firstAsyncIndex}..${handler.updates.length}`);
  handler.updates.forEach((update, updateIndex) => {
    const guardTexts = update.guards.map(formatGuard);
    if (cutName && updateIndex >= firstAsyncIndex) guardTexts.push(`${cutName} > ${updateIndex}`);
    const updatedVariables = context.variables.filter(
      (variable) => variable.role === "state" && variable.binding.id === update.binding.id,
    );
    const nextTexts = updatedVariables.map((variable) => {
      const projected = projectValue(update.value, variable.place.path);
      const translated = projected ? translateValue(projected, scope) : null;
      if (translated) return translated.text;
      const pick = context.allocateName(`${variable.name}_unknown`);
      choices.push(`${pick} \\in ${variable.domain}`);
      return pick;
    });
    updatedVariables.forEach((variable, variableIndex) => {
      const placeKey = getPlaceKey(variable.place);
      const previous = scope.namesByPlace.get(placeKey) ?? variable.name;
      if (nextTexts[variableIndex] === previous) return;
      const stepName = context.allocateName(`${variable.name}_${updateIndex + 1}`);
      definitions.push(
        guardTexts.length === 0
          ? `${stepName} == ${nextTexts[variableIndex]}`
          : `${stepName} == IF ${guardTexts.join(" /\\ ")} THEN ${nextTexts[variableIndex]} ELSE ${previous}`,
      );
      scope.namesByPlace.set(placeKey, stepName);
    });
  });
  const enabledLines = [
    ...handler.guards.flatMap((guard) => translateCondition(guard, context.stateScope) ?? []),
    ...(isMountOnlyEffect(handler) ? ["fresh"] : []),
  ];
  const stepLines = [
    ...context.variables
      .filter((variable) => variable.role === "state")
      .map((variable) => {
        const finalName = scope.namesByPlace.get(getPlaceKey(variable.place));
        return finalName === variable.name
          ? `UNCHANGED ${variable.name}`
          : `${variable.name}' = ${finalName}`;
      }),
    ...context.stepLines,
  ];
  const step =
    definitions.length === 0
      ? formatConjunction(stepLines, "     ")
      : `\n     LET ${definitions.join("\n         ")}\n     IN${formatConjunction(stepLines, "       ")}`;
  const chosen = choices.map((choice) => `\\E ${choice} :`).join(" ");
  const header = [label, formatLine(handler.loc)].filter(Boolean).join(" · ");
  return {
    name,
    text: `\\* ${header}\n${name} ==${formatConjunction([...enabledLines, `${chosen}${step}`.trimStart()], "  ")}`,
  };
};

export const formatTla = (component: AnalyzedComponent, options: TlaOptions): TlaSpec => {
  const { analysis } = component;
  const allocateName = createNameAllocator();
  const moduleName = allocateName(options.moduleName);
  const objectNames = new Map<string, string>();
  const getObjectName = (typeText: string): string => {
    const name = objectNames.get(typeText) ?? allocateName(`Object${objectNames.size + 1}`);
    objectNames.set(typeText, name);
    return name;
  };
  const variables = createVariables(component, allocateName, getObjectName);
  const stateScope = createScope(variables);
  const initScope = createScope(variables.filter((variable) => variable.role !== "state"));

  const branchesByTestKey = collectBranches(analysis.render, options.rootDirectory, allocateName);
  const branches = [...branchesByTestKey.values()];
  const branchKeys = [...new Set(branches.map((branch) => branch.key))];
  const branchIndexByKey = new Map(branchKeys.map((key, index) => [key, index]));
  const branchTexts = new Map(
    branches.map((branch) => [branch, translateCondition(branch.test, stateScope)]),
  );
  const freeVariables = new Map(
    branches
      .filter((branch) => branchTexts.get(branch) === null)
      .map((branch) => [branch, allocateName(branch.name.toLowerCase())]),
  );
  const regions = findRegions(analysis.render, analysis.bindings);
  const regionTexts = regions.map(
    (region) => formatRegion(analysis.render, region, branchesByTestKey, branchIndexByKey) ?? '""',
  );

  const constantNames = variables
    .filter((variable) => variable.role === "constant")
    .map((variable) => variable.name);
  const hasMountEffects =
    analysis.handlers.some(isMountOnlyEffect) ||
    (variables.length === 0 && branches.every((branch) => branchTexts.get(branch) !== null));
  const context: SpecContext = {
    allocateName,
    variables,
    stateScope,
    stepLines: [
      ...(constantNames.length > 0 ? [`UNCHANGED <<${constantNames.join(", ")}>>`] : []),
      ...variables
        .filter((variable) => variable.role === "external")
        .map((variable) => `${variable.name}' \\in ${variable.domain}`),
      ...[...freeVariables.values()].map((name) => `${name}' \\in BOOLEAN`),
      ...(hasMountEffects ? ["fresh' = FALSE"] : []),
    ],
  };
  const triggerLabels = collectTriggerLabels(component, createSourceReader());
  const actions = analysis.handlers.map((handler) =>
    formatAction(handler, triggerLabels.get(handler.id), context),
  );
  const initLines = [
    ...variables
      .filter((variable) => variable.role !== "state")
      .map((variable) => `${variable.name} \\in ${variable.domain}`),
    ...variables
      .filter((variable) => variable.role === "state")
      .map((variable) => formatInitialValue(variable, initScope)),
    ...[...freeVariables.values()].map((name) => `${name} \\in BOOLEAN`),
    ...(hasMountEffects ? ["fresh = TRUE"] : []),
  ];
  const settledLines = analysis.handlers
    .filter((handler) => handler.trigger.kind === "Render")
    .flatMap((handler) => handler.updates)
    .filter((update) => !update.isMemoized && update.guards.length > 0)
    .flatMap((update) => {
      const guards = update.guards.map((guard) => translateCondition(guard, stateScope));
      return guards.every((guard) => guard !== null) ? `~(${guards.join(" /\\ ")})` : [];
    });
  const variableNames = [
    ...variables.map((variable) => variable.name),
    ...freeVariables.values(),
    ...(hasMountEffects ? ["fresh"] : []),
  ];
  const constants = ["Null", "Undefined", ...objectNames.values()];
  const regionNames = regionTexts.map((_text, regionIndex) => `Region${regionIndex + 1}`);
  const source = [
    `---- MODULE ${moduleName} ----`,
    "EXTENDS Integers, Sequences",
    `CONSTANTS ${constants.join(", ")}`,
    `VARIABLES ${variableNames.join(", ")}`,
    `vars == <<${variableNames.join(", ")}>>`,
    "",
    ...branches.map(
      (branch) =>
        `${branch.name} == ${freeVariables.get(branch) ?? branchTexts.get(branch)}  \\* ${branch.location}`,
    ),
    "",
    `Init ==${formatConjunction(initLines, "  ")}`,
    "",
    ...actions.flatMap((action) => [action.text, ""]),
    `Next == ${actions.length === 0 ? "UNCHANGED vars" : actions.map((action) => action.name).join(" \\/ ")}`,
    "",
    ...regionTexts.map((text, regionIndex) => `${regionNames[regionIndex]} == ${text}`),
    `Screen == <<${regionNames.join(", ")}>>`,
    `Settled == ${settledLines.length === 0 ? "TRUE" : settledLines.join(" /\\ ")}`,
    "====",
    "",
  ].join("\n");
  const config = [
    `CONSTANTS ${constants.map((constant) => `${constant} = ${constant}`).join(" ")}`,
    "INIT Init",
    "NEXT Next",
    "CHECK_DEADLOCK FALSE",
    "",
  ].join("\n");
  return { moduleName, source, config, branchKeys, regionCount: regions.length };
};
