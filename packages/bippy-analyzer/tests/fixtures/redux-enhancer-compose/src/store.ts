import { applyMiddleware, combineReducers, compose, createStore, type Middleware } from "redux";

interface Action {
  type: string;
  item?: string;
}

interface PersistState {
  version: number;
  rehydrated: boolean;
}

const cart = (state = { items: [] as string[] }, action: Action) =>
  action.type === "ADD" && action.item ? { items: [...state.items, action.item] } : state;

const auth = (state = { user: null as string | null }, action: Action) =>
  action.type === "LOGIN" ? { user: "ash" } : state;

const combined = combineReducers({ cart, auth });

interface PersistedState extends ReturnType<typeof combined> {
  _persist?: PersistState;
}

/** Mirrors redux-persist's `persistReducer`: the persistence marker is stripped before the base reducer runs. */
const persistedReducer = (state: PersistedState | undefined, action: Action): PersistedState => {
  const { _persist, ...rest } = state || {};
  if (action.type === "persist/PERSIST") {
    return { ...combined(rest, action), _persist: { version: -1, rehydrated: false } };
  }
  if (action.type === "persist/REHYDRATE" && _persist) {
    return { ...combined(rest, action), _persist: { ..._persist, rehydrated: true } };
  }
  if (!_persist) return combined(rest, action);
  return { ...combined(rest, action), _persist };
};

const logger: Middleware = () => (next) => (action) => next(action);

export const store = createStore(persistedReducer, compose(applyMiddleware(logger)));
store.dispatch({ type: "persist/PERSIST" });
store.dispatch({ type: "ADD", item: "lens" });
store.dispatch({ type: "ADD", item: "frame" });
store.dispatch({ type: "persist/REHYDRATE" });

export type RootState = ReturnType<typeof store.getState>;

const shout = (text: string): string => `${text}!`;
const greet = (text: string): string => `hello ${text}`;

export const composedGreeting = compose(shout, greet)("world");
export const identityGreeting = compose()("plain");
