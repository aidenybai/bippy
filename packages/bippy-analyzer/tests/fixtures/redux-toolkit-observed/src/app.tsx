import { skipToken } from "@reduxjs/toolkit/query/react";
import { useSelector } from "react-redux";
import { useGetPokemonByNameQuery, useGetTrainerQuery } from "./pokemon-api";
import { describeBoundActions, resetSettings, settingsSlice } from "./settings-slice";
import type { RootState } from "./store";

const Ability = ({ name }: { name: string }) => <li>{name}</li>;

const Settings = () => {
  const theme = useSelector((state: RootState) => state.settings.theme);
  const labels = useSelector((state: RootState) => state.settings.labels);
  const added = settingsSlice.actions.addLabel("  narrow ");
  const facts = [
    theme === "dark",
    labels.join("/") === "compact/wide",
    settingsSlice.getInitialState().theme === "dark",
    settingsSlice.actions.setTheme("light").type === "settings/setTheme",
    added.type === "settings/addLabel" && added.payload === "narrow",
    added.meta.source === "prepare",
    resetSettings().type === "settings/reset",
    describeBoundActions(() => undefined) === "setTheme,addLabel",
  ];
  return (
    <dl>
      <dt>{theme}</dt>
      {facts.map((isTrue, index) => (isTrue ? <dd key={index}>yes</dd> : <em key={index}>no</em>))}
    </dl>
  );
};

export const App = () => {
  const { data, error, isLoading, isFetching } = useGetPokemonByNameQuery("bulbasaur");
  const missing = useGetPokemonByNameQuery("missingno");
  const skipped = useGetPokemonByNameQuery(skipToken);
  const trainer = useGetTrainerQuery(undefined, { skip: true });
  if (isLoading) return <p className="loading">loading</p>;
  if (error || !data) return <p className="error">failed</p>;
  return (
    <section>
      <h3>{data.name}</h3>
      <img src={data.sprites.front_default} alt={data.name} />
      {isFetching ? <span>refreshing</span> : null}
      <Settings />
      <ul>
        {data.abilities.map((entry) => (
          <Ability key={entry.ability.name} name={entry.ability.name} />
        ))}
      </ul>
      {missing.isError ? (
        <em>{missing.error && "message" in missing.error ? missing.error.message : "error"}</em>
      ) : null}
      {skipped.isUninitialized && trainer.isUninitialized ? (
        <small>skipped</small>
      ) : (
        <strong>ran</strong>
      )}
    </section>
  );
};
