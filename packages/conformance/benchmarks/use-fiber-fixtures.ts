import {
  earlyReactVersionFixtures,
  reactVersionFixtures,
} from "../tests/unit/isolated-react-runtime.js";

export interface UseFiberConfiguration {
  components: number;
  precedingHooks: number;
}

export const getUseFiberFixtures = (quick: boolean) =>
  [...earlyReactVersionFixtures, ...reactVersionFixtures].filter(
    ({ label }) => !quick || label === "19",
  );

export const getUseFiberConfigurations = (quick: boolean): UseFiberConfiguration[] =>
  quick
    ? [{ components: 10, precedingHooks: 0 }]
    : [100, 1000].flatMap((components) =>
        [0, 32].map((precedingHooks) => ({ components, precedingHooks })),
      );
