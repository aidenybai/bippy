import type { ViewBinding, ViewComponent, ViewFile } from "@/model";

export const getSourceLine = (view: ViewFile, line: number): string =>
  view.source.split("\n")[line - 1]?.trim() ?? "";

export const shortenType = (value: string): string => value.replace(/<[\s\S]*>$/, "<…>");

export const getDomainValues = (binding: ViewBinding): string[] =>
  binding.domain.split(" | ").map((value) => value.trim());

export interface StateStep {
  handlerId: string;
  from: number;
  to: number;
  isAsync: boolean;
}

export const getStateSteps = (component: ViewComponent): StateStep[] =>
  component.states.flatMap((state) =>
    state.steps.flatMap((step) =>
      step.targets.map((target) => ({
        handlerId: step.handlerId,
        from: state.index,
        to: target,
        isAsync: step.isAsync,
      })),
    ),
  );
