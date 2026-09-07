import { skipToken } from "@reduxjs/toolkit/query/react";
import { useGetPokemonByNameQuery, useGetTrainerQuery } from "./pokemon-api";

const Ability = ({ name }: { name: string }) => <li>{name}</li>;

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
