import { ABSTRACTION, ARITHMETIC, LIBRARY_MODULES, LIMIT } from "./abstraction";
import { forEachTerm } from "./terms";
import { NO_VIEW } from "./views";
import type {
  Abstract,
  Action,
  Initial,
  NextValue,
  ModelSpec,
  Predicate,
  Term,
  Variable,
} from "./types";

interface Definition {
  name: string;
  expression: string;
}

const quote = (text: string): string => `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

const quoteText = (text: string): string =>
  quote(text).replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");

const formatComment = (text: string): string => `\\* ${text.replace(/\s+/g, " ")}`;

const formatSet = (values: string[]): string => `{${values.map(quote).join(", ")}}`;

const formatPredicate = (predicate: Predicate): string => {
  switch (predicate.kind) {
    case "True":
      return "TRUE";
    case "False":
      return "FALSE";
    case "In": {
      if (predicate.values.length === 1)
        return `${predicate.variable} = ${quote(predicate.values[0])}`;
      const excluded = predicate.domain.filter((value) => !predicate.values.includes(value));
      if (excluded.length === 1) return `${predicate.variable} /= ${quote(excluded[0])}`;
      return `${predicate.variable} \\in ${formatSet(predicate.values)}`;
    }
    case "Not":
      return `~(${formatPredicate(predicate.operand)})`;
    case "And":
      return predicate.conjuncts.map(formatPart).join(" /\\ ");
    case "Or":
      return predicate.disjuncts.map(formatPart).join(" \\/ ");
  }
};

const formatPart = (predicate: Predicate): string =>
  predicate.kind === "And" || predicate.kind === "Or"
    ? `(${formatPredicate(predicate)})`
    : formatPredicate(predicate);

const isRepresentable = (value: number): boolean =>
  Number.isInteger(value) && Math.abs(value) <= LIMIT;

const formatLow = (value: number, isIncluded: boolean): { text: string; isIncluded: boolean } => {
  if (value < -LIMIT) return { text: "-Infinity", isIncluded: isIncluded || value !== -Infinity };
  if (value > LIMIT) return { text: String(LIMIT), isIncluded: true };
  return { text: String(Math.floor(value)), isIncluded: isIncluded || !Number.isInteger(value) };
};

const formatHigh = (value: number, isIncluded: boolean): { text: string; isIncluded: boolean } => {
  if (value > LIMIT) return { text: "Infinity", isIncluded: isIncluded || value !== Infinity };
  if (value < -LIMIT) return { text: String(-LIMIT), isIncluded: true };
  return { text: String(Math.ceil(value)), isIncluded: isIncluded || !Number.isInteger(value) };
};

const formatRange = (
  min: number,
  max: number,
  isMinIncluded: boolean,
  isMaxIncluded: boolean,
): string => {
  const low = formatLow(min, isMinIncluded);
  const high = formatHigh(max, isMaxIncluded);
  return `Range(${low.text}, ${high.text}, ${low.isIncluded ? "TRUE" : "FALSE"}, ${high.isIncluded ? "TRUE" : "FALSE"})`;
};

const formatExact = (value: Extract<Abstract, { kind: "Exact" }>["value"]): string => {
  if (value === null) return "Null";
  if (value === undefined) return "Undefined";
  if (typeof value === "string") return `Str(${quoteText(value)})`;
  if (typeof value === "boolean") return `Bool(${value ? "TRUE" : "FALSE"})`;
  if (Number.isNaN(value)) return "NaN";
  return isRepresentable(value)
    ? `Num(${value === 0 ? 0 : value})`
    : formatRange(value, value, true, true);
};

const formatAbstract = (value: Abstract): string => {
  switch (value.kind) {
    case "Exact":
      return formatExact(value.value);
    case "Range":
      return formatRange(value.min, value.max, value.isMinIncluded, value.isMaxIncluded);
    case "Other": {
      const excluded = value.excluded
        .filter(
          (literal) =>
            typeof literal !== "number" || Number.isNaN(literal) || isRepresentable(literal),
        )
        .map(formatExact);
      const set = excluded.length > 0 ? excluded.join(" \\cup ") : "{}";
      return `${value.type === "string" ? "OtherString" : "OtherValue"}(${set})`;
    }
    case "Object":
      return "Object";
    case "Truthy":
      return "Truthy";
    case "Falsy":
      return "Falsy";
    case "Any":
      return "Unknown";
  }
};

const formatRead = (variable: string): string => `Values.${variable}[${variable}]`;

const formatTerm = (term: Term): string => {
  switch (term.kind) {
    case "Constant":
      return formatAbstract(term.value);
    case "Read":
      return formatRead(term.variable);
    case "Plus":
      return `Plus(${formatTerm(term.left)}, ${formatTerm(term.right)})`;
    case "Minus":
      return `Minus(${formatTerm(term.left)}, ${formatTerm(term.right)})`;
    case "Negative":
      return `Negative(${formatTerm(term.operand)})`;
    case "If":
      return `(IF ${formatPredicate(term.predicate)} THEN ${formatTerm(term.consequent)} ELSE ${formatTerm(term.alternate)})`;
    case "Either":
      return `(${term.terms.map(formatTerm).join(" \\cup ")})`;
  }
};

const formatLabels = (variable: string, term: Term): string =>
  `Labels(Values.${variable}, ${formatTerm(term)})`;

const formatNextValue = (next: NextValue, variable: string): string => {
  switch (next.kind) {
    case "Unchanged":
      return `{${variable}}`;
    case "Copy":
      return `{${next.variable}}`;
    case "Values":
      return formatSet(next.values);
    case "Evaluate":
      return formatLabels(variable, next.term);
    case "If":
      return `(IF ${formatPredicate(next.predicate)} THEN ${formatNextValue(next.consequent, variable)} ELSE ${formatNextValue(next.alternate, variable)})`;
  }
};

const formatWrite = (variable: string, next: NextValue): string => {
  if (next.kind === "Copy") return `${variable}' = ${next.variable}`;
  return next.kind === "Values" && next.values.length === 1
    ? `${variable}' = ${quote(next.values[0])}`
    : `${variable}' \\in ${formatNextValue(next, variable)}`;
};

const ARITHMETIC_TERMS: ReadonlySet<Term["kind"]> = new Set(["Plus", "Minus", "Negative"]);

interface Evaluation {
  names: Set<string>;
  isArithmetic: boolean;
}

const collectEvaluation = (evaluation: Evaluation, variable: string, next: NextValue): void => {
  if (next.kind === "If") {
    collectEvaluation(evaluation, variable, next.consequent);
    collectEvaluation(evaluation, variable, next.alternate);
  }
  if (next.kind !== "Evaluate") return;
  evaluation.names.add(variable);
  forEachTerm(next.term, (term) => {
    if (term.kind === "Read") evaluation.names.add(term.variable);
    if (ARITHMETIC_TERMS.has(term.kind)) evaluation.isArithmetic = true;
  });
};

const getEvaluation = (model: ModelSpec): { variables: Variable[]; library: string | null } => {
  const evaluation: Evaluation = { names: new Set(), isArithmetic: false };
  for (const variable of model.variables)
    collectEvaluation(evaluation, variable.name, variable.initial);
  for (const action of model.actions)
    for (const write of action.writes) collectEvaluation(evaluation, write.variable, write.next);
  const variables = model.variables.filter((variable) => evaluation.names.has(variable.name));
  if (variables.length === 0) return { variables, library: null };
  return { variables, library: evaluation.isArithmetic ? ARITHMETIC : ABSTRACTION };
};

export const formatLibrary = (models: ModelSpec[]): string[] => {
  const libraries = new Set(models.map((model) => getEvaluation(model).library));
  const names = libraries.has(ARITHMETIC)
    ? [ABSTRACTION, ARITHMETIC]
    : [...libraries].filter((library) => library !== null);
  return names.flatMap((name) => LIBRARY_MODULES.get(name) ?? []);
};

const formatValues = (variables: Variable[]): string[] => [
  "Values == [",
  ...variables.map(
    (variable, index) =>
      `  ${variable.name} |-> ${variable.domain
        .map((value) => `${quote(value.label)} :> ${formatAbstract(value.abstract)}`)
        .join(" @@ ")}${index < variables.length - 1 ? "," : ""}`,
  ),
  "]",
];

const formatAction = (action: Action, variables: Variable[]): string[] => {
  const written = new Set(action.writes.map((write) => write.variable));
  const unchanged = variables
    .filter((variable) => !written.has(variable.name))
    .map((variable) => variable.name);
  const conjuncts = [
    formatPredicate(action.guard),
    ...action.writes.map((write) => formatWrite(write.variable, write.next)),
    ...(unchanged.length > 0 ? [`UNCHANGED <<${unchanged.join(", ")}>>`] : []),
  ].filter((conjunct) => conjunct !== "TRUE");
  return [
    formatComment(action.label),
    `${action.name} ==`,
    ...conjuncts.map((conjunct) => `  /\\ ${conjunct}`),
  ];
};

const formatInitial = (name: string, initial: Initial): string => {
  if (initial.kind === "Evaluate") return `${name} \\in ${formatLabels(name, initial.term)}`;
  return initial.values.length === 1
    ? `${name} = ${quote(initial.values[0])}`
    : `${name} \\in ${formatSet(initial.values)}`;
};

const formatView = (model: ModelSpec): string[] => {
  if (model.views.length === 0) return [`view == ${quote(NO_VIEW)}`];
  const [first, ...rest] = model.views;
  return [
    `view == CASE ${formatPredicate(first.predicate)} -> ${quote(first.label)}`,
    ...rest.map(
      (view) => `          [] ${formatPredicate(view.predicate)} -> ${quote(view.label)}`,
    ),
    `          [] OTHER -> ${quote(NO_VIEW)}`,
  ];
};

const toModuleName = (name: string): string => {
  const moduleName = name.replace(/[^A-Za-z0-9_]/g, "_").replace(/^([0-9])/, "M$1") || "Component";
  return LIBRARY_MODULES.has(moduleName) ? `${moduleName}_` : moduleName;
};

const getExtendedModules = (library: string | null, definitions: Definition[]): string[] => {
  if (library) return [library];
  return definitions.length > 0 ? ["Naturals", "TLC"] : [];
};

export const formatTla = (
  name: string,
  model: ModelSpec,
  definitions: Definition[] = [],
): string => {
  const names = model.variables.map((variable) => variable.name);
  const evaluation = getEvaluation(model);
  const modules = getExtendedModules(evaluation.library, definitions);
  const variableComments = model.variables.map((variable) =>
    formatComment(
      `${variable.name}: ${variable.label} (${variable.source}), ${variable.domain.length} values`,
    ),
  );
  const lines = [
    `---- MODULE ${toModuleName(name)} ----`,
    ...(modules.length > 0 ? [`EXTENDS ${modules.join(", ")}`] : []),
    ...variableComments,
    ...(names.length > 0 ? [`VARIABLES ${names.join(", ")}`, ""] : [""]),
    `vars == <<${names.join(", ")}>>`,
    "",
    ...(evaluation.library ? [...formatValues(evaluation.variables), ""] : []),
    ...formatView(model),
    "",
    "Init ==",
    ...(model.variables.length > 0
      ? model.variables.map((variable) => `  /\\ ${formatInitial(variable.name, variable.initial)}`)
      : ["  TRUE"]),
    "",
    ...model.actions.flatMap((action) => [...formatAction(action, model.variables), ""]),
    `Next == ${model.actions.length > 0 ? model.actions.map((action) => action.name).join(" \\/ ") : "UNCHANGED vars"}`,
    "",
    "Spec == Init /\\ [][Next]_vars",
    ...model.invariants.flatMap((invariant) => [
      "",
      formatComment(invariant.label),
      `${invariant.name} == ${formatPredicate(invariant.predicate)}`,
    ]),
    ...definitions.flatMap((definition) => ["", `${definition.name} == ${definition.expression}`]),
    "====",
  ];
  return lines.join("\n");
};
