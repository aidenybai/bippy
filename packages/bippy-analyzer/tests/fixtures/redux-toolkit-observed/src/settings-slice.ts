import {
  bindActionCreators,
  createAction,
  createSlice,
  type PayloadAction,
} from "@reduxjs/toolkit";

interface SettingsState {
  theme: string;
  labels: string[];
}

const initialState: SettingsState = { theme: "dark", labels: ["compact", "wide"] };

export const settingsSlice = createSlice({
  name: "settings",
  initialState,
  reducers: {
    setTheme(state, action: PayloadAction<string>) {
      state.theme = action.payload;
    },
    addLabel: {
      reducer(state, action: PayloadAction<string, string, { source: string }>) {
        state.labels.push(action.payload);
      },
      prepare(label: string) {
        return { payload: label.trim(), meta: { source: "prepare" } };
      },
    },
  },
});

export const resetSettings = createAction("settings/reset");

export const describeBoundActions = (dispatch: (action: unknown) => unknown): string =>
  Object.keys(bindActionCreators(settingsSlice.actions, dispatch)).join(",");
