import { applyMiddleware, combineReducers, compose, createStore, type Middleware } from "redux";

export interface CustomizationState {
  isDarkMode: boolean;
  fontFamily: string;
  opened: boolean;
}

interface Action {
  type: string;
  opened?: boolean;
}

const customization = (
  state: CustomizationState = { isDarkMode: false, fontFamily: "Inter", opened: true },
  action: Action,
): CustomizationState => {
  switch (action.type) {
    case "SET_MENU":
      return { ...state, opened: action.opened ?? state.opened };
    default:
      return state;
  }
};

const auth = (state = { isAuthenticated: false, user: null as string | null }, action: Action) =>
  action.type === "LOGIN" ? { isAuthenticated: true, user: "ash" } : state;

const appReducer = combineReducers({ customization, auth });

/** A hand-written root reducer wrapping `combineReducers`, as apps that reset state on logout do. */
const rootReducer = (state: ReturnType<typeof appReducer> | undefined, action: Action) =>
  appReducer(action.type === "LOGOUT" ? undefined : state, action);

const logger: Middleware = () => (next) => (action) => next(action);

export const store = createStore(rootReducer, compose(applyMiddleware(logger)));

export type RootState = ReturnType<typeof store.getState>;
