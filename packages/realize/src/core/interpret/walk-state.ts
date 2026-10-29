import type { SymbolicValue } from "../types";

export interface WalkState {
  guards: SymbolicValue[];
  renderGuards: SymbolicValue[];
  isAsync: boolean;
  frame?: number;
}

export const ROOT_WALK_STATE: WalkState = { guards: [], renderGuards: [], isAsync: false };

export const getClaimGuards = (walkState: WalkState): SymbolicValue[] => [
  ...walkState.renderGuards,
  ...walkState.guards,
];

export const getAsyncWalkState = (walkState: WalkState): WalkState => ({
  ...walkState,
  isAsync: true,
});
