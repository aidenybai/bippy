import type { SymbolicValue } from "../types";

export interface PathState {
  guards: SymbolicValue[];
  renderGuards: SymbolicValue[];
  isAsync: boolean;
  frame?: number;
}

export const ROOT_PATH_STATE: PathState = { guards: [], renderGuards: [], isAsync: false };

export const getAssertionGuards = (pathState: PathState): SymbolicValue[] => [
  ...pathState.renderGuards,
  ...pathState.guards,
];

export const getAsyncPathState = (pathState: PathState): PathState => ({
  ...pathState,
  isAsync: true,
});
