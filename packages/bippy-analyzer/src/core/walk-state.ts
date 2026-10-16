import type { SymbolicValue } from "./types";

export interface WalkState {
  guards: SymbolicValue[];
  isAsync: boolean;
}

export const ROOT_WALK_STATE: WalkState = { guards: [], isAsync: false };

export const getAsyncWalkState = (walkState: WalkState): WalkState => ({
  ...walkState,
  isAsync: true,
});
