export interface SessionState {
  user: string | null;
  isReady: boolean;
}

let state: SessionState = { user: null, isReady: false };
const listeners = new Set<() => void>();

export const sessionStore = {
  get: (): SessionState => state,
  set: (next: SessionState): void => {
    state = next;
    for (const listener of listeners) listener();
  },
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
