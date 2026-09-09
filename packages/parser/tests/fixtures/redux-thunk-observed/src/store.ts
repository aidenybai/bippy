import { configureStore } from "@reduxjs/toolkit";
import { applyMiddleware, isAction, legacy_createStore, type Middleware } from "redux";
import { withExtraArgument } from "redux-thunk";

export interface ServerState {
  label: string;
  isChecked: boolean;
}

interface ServerAction {
  type: string;
}

const server = (
  state: ServerState = { label: "api", isChecked: false },
  action: ServerAction,
): ServerState => (action.type === "server/checked" ? { ...state, isChecked: true } : state);

/** Swallows `noise` actions before the reducer sees them, answering with a marker instead. */
const muteNoise: Middleware = () => (next) => (action) =>
  isAction(action) && action.type === "noise" ? "muted" : next(action);

export const store = configureStore({
  reducer: { server },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({ thunk: { extraArgument: "toolkit" } }).concat(muteNoise),
});

export const legacyStore = legacy_createStore(server, applyMiddleware(withExtraArgument("legacy")));

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
