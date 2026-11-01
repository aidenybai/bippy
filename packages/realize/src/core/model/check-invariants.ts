import { check, formatValue, type TraceStep as TlaTraceStep } from "tla-ts";
import { formatTla, type Invariant } from "./tla";
import type { ComponentModel, TraceStep } from "./types";

export type InvariantResult =
  | { name: string; status: "holds" }
  | { name: string; status: "violated"; trace: TraceStep[] }
  | { name: string; status: "error"; message: string };

const unquote = (text: string): string =>
  text.startsWith('"') && text.endsWith('"') ? text.slice(1, -1) : text;

const toTraceStep = (
  step: TlaTraceStep,
  model: ComponentModel,
  screenOf: (cells: Record<string, string>) => string,
): TraceStep => {
  const cells = Object.fromEntries(
    model.lanes.map((lane) => {
      const value = step.state[lane.name];
      return [lane.name, value === undefined ? "?" : unquote(formatValue(value))];
    }),
  );
  const action = step.action
    ? (model.actions.find((candidate) => candidate.name === step.action)?.label ?? step.action)
    : null;
  return { action, cells, screen: screenOf(cells) };
};

export const checkInvariant = async (
  name: string,
  model: ComponentModel,
  invariant: Invariant,
  screenOf: (cells: Record<string, string>) => string,
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
      trace: result.violation.trace.map((step) => toTraceStep(step, model, screenOf)),
    };
  return {
    name: invariant.name,
    status: "error",
    message: result.failure?.message ?? result.status,
  };
};
