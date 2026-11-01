import type { Action, Choice, ComponentModel, Condition, Lane } from "./types";

export interface Invariant {
  name: string;
  expression: string;
}

const quote = (text: string): string => `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

const formatSet = (cells: string[]): string => `{${cells.map(quote).join(", ")}}`;

export const formatCondition = (condition: Condition): string => {
  switch (condition.kind) {
    case "True":
      return "TRUE";
    case "False":
      return "FALSE";
    case "In": {
      if (condition.cells.length === 1) return `${condition.lane} = ${quote(condition.cells[0])}`;
      const excluded = condition.allCells.filter((cell) => !condition.cells.includes(cell));
      if (excluded.length === 1) return `${condition.lane} /= ${quote(excluded[0])}`;
      return `${condition.lane} \\in ${formatSet(condition.cells)}`;
    }
    case "Not":
      return `~(${formatCondition(condition.condition)})`;
    case "And":
      return condition.conditions.map(formatPart).join(" /\\ ");
    case "Or":
      return condition.conditions.map(formatPart).join(" \\/ ");
  }
};

const formatPart = (condition: Condition): string =>
  condition.kind === "And" || condition.kind === "Or"
    ? `(${formatCondition(condition)})`
    : formatCondition(condition);

const formatChoice = (choice: Choice, lane: string): string => {
  switch (choice.kind) {
    case "Keep":
      return `{${lane}}`;
    case "Cells":
      return formatSet(choice.cells);
    case "If":
      return `(IF ${formatCondition(choice.condition)} THEN ${formatChoice(choice.consequent, lane)} ELSE ${formatChoice(choice.alternate, lane)})`;
  }
};

const formatWrite = (lane: string, choice: Choice): string =>
  choice.kind === "Cells" && choice.cells.length === 1
    ? `${lane}' = ${quote(choice.cells[0])}`
    : `${lane}' \\in ${formatChoice(choice, lane)}`;

const formatAction = (action: Action, lanes: Lane[]): string[] => {
  const written = new Set(action.writes.map(({ lane }) => lane));
  const unchanged = lanes.filter((lane) => !written.has(lane.name)).map((lane) => lane.name);
  const conjuncts = [
    formatCondition(action.guard),
    ...action.writes.map(({ lane, choice }) => formatWrite(lane, choice)),
    ...(unchanged.length > 0 ? [`UNCHANGED <<${unchanged.join(", ")}>>`] : []),
  ].filter((conjunct) => conjunct !== "TRUE");
  return [
    `\\* ${action.label}`,
    `${action.name} ==`,
    ...conjuncts.map((conjunct) => `  /\\ ${conjunct}`),
  ];
};

const formatInitial = (lane: Lane): string =>
  lane.initial.length === 1
    ? `${lane.name} = ${quote(lane.initial[0])}`
    : `${lane.name} \\in ${formatSet(lane.initial)}`;

const formatScreen = (model: ComponentModel): string[] => {
  if (model.screens.length === 0) return ['screen == "nothing"'];
  const [first, ...rest] = model.screens;
  return [
    `screen == CASE ${formatCondition(first.condition)} -> ${quote(first.label)}`,
    ...rest.map(
      (screen) => `            [] ${formatCondition(screen.condition)} -> ${quote(screen.label)}`,
    ),
    `            [] OTHER -> "nothing"`,
  ];
};

export const toModuleName = (name: string): string =>
  name.replace(/[^A-Za-z0-9_]/g, "_").replace(/^([0-9])/, "M$1") || "Component";

export const formatTla = (
  name: string,
  model: ComponentModel,
  invariants: Invariant[] = [],
): string => {
  const { lanes, actions } = model;
  const variables = lanes.map((lane) => lane.name);
  const laneComments = lanes.map(
    (lane) => `\\* ${lane.name}: ${lane.label} (${lane.source}), ${lane.cells.length} cells`,
  );
  const lines = [
    `---- MODULE ${toModuleName(name)} ----`,
    ...laneComments,
    ...(variables.length > 0 ? [`VARIABLES ${variables.join(", ")}`, ""] : [""]),
    `vars == <<${variables.join(", ")}>>`,
    "",
    ...formatScreen(model),
    "",
    "Init ==",
    ...(lanes.length > 0 ? lanes.map((lane) => `  /\\ ${formatInitial(lane)}`) : ["  TRUE"]),
    "",
    ...actions.flatMap((action) => [...formatAction(action, lanes), ""]),
    `Next == ${actions.length > 0 ? actions.map((action) => action.name).join(" \\/ ") : "FALSE"}`,
    "",
    "Spec == Init /\\ [][Next]_vars",
    ...model.properties.flatMap((property) => [
      "",
      `\\* ${property.label.replace(/\s+/g, " ")}`,
      `${property.name} == ${formatCondition(property.condition)}`,
    ]),
    ...invariants.flatMap((invariant) => ["", `${invariant.name} == ${invariant.expression}`]),
    "====",
  ];
  return lines.join("\n");
};
