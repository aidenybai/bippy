import { createApi, fakeBaseQuery } from "@reduxjs/toolkit/query/react";

export interface Pokemon {
  name: string;
  sprites: { front_default: string };
  abilities: { ability: { name: string } }[];
}

const POKEMON: Record<string, Pokemon> = {
  bulbasaur: {
    name: "bulbasaur",
    sprites: { front_default: "/sprites/1.png" },
    abilities: [{ ability: { name: "overgrow" } }, { ability: { name: "chlorophyll" } }],
  },
};

export const pokemonApi = createApi({
  reducerPath: "pokemonApi",
  baseQuery: fakeBaseQuery<{ message: string }>(),
  endpoints: (build) => ({
    getPokemonByName: build.query<Pokemon, string>({
      queryFn: async (name) => {
        const pokemon = POKEMON[name];
        return pokemon ? { data: pokemon } : { error: { message: `no pokemon named ${name}` } };
      },
    }),
    getTrainer: build.query<{ name: string }, void>({
      queryFn: async () => ({ data: { name: "ash" } }),
    }),
  }),
});

export const { useGetPokemonByNameQuery, useGetTrainerQuery } = pokemonApi;
