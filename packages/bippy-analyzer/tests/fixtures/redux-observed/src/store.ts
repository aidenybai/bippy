import { combineReducers, createStore } from "redux";

export interface CustomizationState {
  isDarkMode: boolean;
  fontFamily: string;
  opened: boolean;
}

export const initialCustomization: CustomizationState = {
  isDarkMode: localStorage.getItem("isDarkMode") === "true",
  fontFamily: "Inter",
  opened: true,
};

interface Action {
  type: string;
  opened?: boolean;
}

const customization = (state = initialCustomization, action: Action): CustomizationState => {
  switch (action.type) {
    case "SET_MENU":
      return { ...state, opened: action.opened ?? state.opened };
    case "TOGGLE_DARK_MODE":
      return { ...state, isDarkMode: !state.isDarkMode };
    default:
      return state;
  }
};

const auth = (state = { isAuthenticated: false, user: null as string | null }, action: Action) =>
  action.type === "LOGIN" ? { isAuthenticated: true, user: "ash" } : state;

export const store = createStore(combineReducers({ customization, auth }));

export type RootState = ReturnType<typeof store.getState>;
