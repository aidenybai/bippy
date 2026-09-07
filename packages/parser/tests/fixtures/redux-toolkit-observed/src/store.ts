import { combineReducers, configureStore } from "@reduxjs/toolkit";
import { pokemonApi } from "./pokemon-api";

const rootReducer = combineReducers({
  [pokemonApi.reducerPath]: pokemonApi.reducer,
});

export const store = configureStore({
  reducer: rootReducer,
  middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(pokemonApi.middleware),
});
