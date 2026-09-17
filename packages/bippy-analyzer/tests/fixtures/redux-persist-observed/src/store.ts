import { combineReducers, configureStore, createSlice } from "@reduxjs/toolkit";
import { persistReducer, persistStore } from "redux-persist";
import storage from "redux-persist/lib/storage";

const themeSlice = createSlice({
  name: "theme",
  initialState: { mode: "light", isCompact: false },
  reducers: {
    toggleMode: (state) => {
      state.mode = state.mode === "light" ? "dark" : "light";
    },
  },
});

const authSlice = createSlice({
  name: "auth",
  initialState: { user: null as string | null },
  reducers: {
    signIn: (state, action: { payload: string }) => {
      state.user = action.payload;
    },
  },
});

const rootReducer = combineReducers({
  theme: themeSlice.reducer,
  auth: authSlice.reducer,
});

const persistedReducer = persistReducer(
  { key: "root", storage, whitelist: ["theme"] },
  rootReducer,
);

export const store = configureStore({
  reducer: persistedReducer,
  middleware: (getDefaultMiddleware) => getDefaultMiddleware({ serializableCheck: false }),
});

export const persistor = persistStore(store);

export type RootState = ReturnType<typeof store.getState>;
