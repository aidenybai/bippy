import type { ViewBinding, ViewComponent, ViewFile } from "../model";

export const getSourceLine = (view: ViewFile, line: number): string =>
  view.source.split("\n")[line - 1]?.trim() ?? "";

export const shortenType = (value: string): string => value.replace(/<[\s\S]*>$/, "<…>");

export const getDomainValues = (binding: ViewBinding): string[] =>
  binding.domain.split(" | ").map((value) => value.trim());

export interface StateTransition {
  handlerId: string;
  from: number;
  to: number;
  isAsync: boolean;
}

export const getStateTransitions = (
  component: ViewComponent,
  stateIndexes: number[],
): StateTransition[] =>
  stateIndexes
    .flatMap((index) => component.states[index] ?? [])
    .flatMap((state) =>
      state.transitions.flatMap((transition) =>
        transition.targets
          .filter((target) => target !== state.index && stateIndexes.includes(target))
          .map((target) => ({
            handlerId: transition.handlerId,
            from: state.index,
            to: target,
            isAsync: transition.isAsync,
          })),
      ),
    );
