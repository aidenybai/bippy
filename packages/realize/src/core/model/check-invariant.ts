import { check, formatValue, type TraceStep as TlaTraceStep } from "tla-ts";
import { getViewLabel } from "./state-graph";
import { formatTla, type InvariantDefinition } from "./tla";
import type { ComponentModel, TraceStep } from "./types";

export type InvariantResult =
  | { name: string; status: "holds" }
  | { name: string; status: "violated"; trace: TraceStep[] }
  | { name: string; status: "error"; message: string };

const unquote = (text: string): string =>
  text.startsWith('"') && text.endsWith('"') ? text.slice(1, -1) : text;

const toTraceStep = (step: TlaTraceStep, model: ComponentModel): TraceStep => {
  const state = Object.fromEntries(
    model.variables.map((variable) => {
      const value = step.state[variable.name];
      return [variable.name, value === undefined ? "?" : unquote(formatValue(value))];
    }),
  );
  const action = step.action
    ? (model.actions.find((candidate) => candidate.name === step.action)?.label ?? step.action)
    : null;
  return { action, state, view: getViewLabel(model.views, (variable) => state[variable]) };
};

export const checkInvariant = async (
  name: string,
  model: ComponentModel,
  invariant: InvariantDefinition,
): Promise<InvariantResult> => {
  const result = await check({
    source: formatTla(name, model, [invariant]),
    config: `INIT Init\nNEXT Next\nINVARIANT ${invariant.name}\nCHECK_DEADLOCK FALSE`,
  });
  if (result.status === "success") return { name: invariant.name, status: "holds" };
  if (result.status === "invariant-violation" && result.violation)
    return {
      name: invariant.name,
      status: "violated",
      trace: result.violation.trace.map((step) => toTraceStep(step, model)),
    };
  return {
    name: invariant.name,
    status: "error",
    message: result.failure?.message ?? result.status,
  };
};
