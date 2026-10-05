import { combineReducers, configureStore } from "@reduxjs/toolkit";
import { pokemonApi } from "./pokemon-api";
import { settingsSlice } from "./settings-slice";

const rootReducer = combineReducers({
  [pokemonApi.reducerPath]: pokemonApi.reducer,
  [settingsSlice.reducerPath]: settingsSlice.reducer,
});

export const store = configureStore({
  reducer: rootReducer,
  middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(pokemonApi.middleware),
});

export type RootState = ReturnType<typeof store.getState>;
