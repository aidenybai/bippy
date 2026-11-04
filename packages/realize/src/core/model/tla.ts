import { NO_VIEW } from "./views";
import type { Action, NextValue, ModelSpec, Predicate, Variable } from "./types";

interface Definition {
  name: string;
  expression: string;
}

const quote = (text: string): string => `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

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

const formatNextValue = (next: NextValue, variable: string): string => {
  switch (next.kind) {
    case "Unchanged":
      return `{${variable}}`;
    case "Copy":
      return `{${next.variable}}`;
    case "Values":
      return formatSet(next.values);
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

const formatInitial = (variable: Variable): string =>
  variable.initial.length === 1
    ? `${variable.name} = ${quote(variable.initial[0])}`
    : `${variable.name} \\in ${formatSet(variable.initial)}`;

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

const PLACEHOLDER: Variable = {
  name: "placeholder",
  label: "TLC needs a variable",
  source: "control",
  bindingKind: null,
  bindingId: null,
  inputBindingIds: [],
  path: [],
  domain: [{ label: "true", abstract: { kind: "Exact", value: true } }],
  initial: ["true"],
};

export const getModuleVariables = (model: ModelSpec): Variable[] =>
  model.variables.length > 0 ? model.variables : [PLACEHOLDER];

const toModuleName = (name: string): string =>
  name.replace(/[^A-Za-z0-9_]/g, "_").replace(/^([0-9])/, "M$1") || "Component";

export const formatTla = (
  name: string,
  model: ModelSpec,
  definitions: Definition[] = [],
): string => {
  const variables = getModuleVariables(model);
  const names = variables.map((variable) => variable.name);
  const variableComments = variables.map((variable) =>
    formatComment(
      `${variable.name}: ${variable.label} (${variable.source}), ${variable.domain.length} values`,
    ),
  );
  const lines = [
    `---- MODULE ${toModuleName(name)} ----`,
    ...(definitions.length > 0 ? ["EXTENDS Naturals, TLC"] : []),
    ...variableComments,
    `VARIABLES ${names.join(", ")}`,
    "",
    `vars == <<${names.join(", ")}>>`,
    "",
    ...formatView(model),
    "",
    "Init ==",
    ...variables.map((variable) => `  /\\ ${formatInitial(variable)}`),
    "",
    ...model.actions.flatMap((action) => [...formatAction(action, variables), ""]),
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
