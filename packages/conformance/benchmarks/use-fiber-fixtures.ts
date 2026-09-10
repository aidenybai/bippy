import assert from "node:assert/strict";
import { verifyRecord } from "./report.js";
import {
  earlyReactVersionFixtures,
  reactVersionFixtures,
} from "../tests/unit/isolated-react-runtime.js";

export interface UseFiberConfiguration {
  components: number;
  precedingHooks: number;
}

export interface UseFiberWorkerConfiguration extends UseFiberConfiguration {
  react: string;
  builtEntryUrl: string;
  reactUrl: string;
  reactDOMUrl: string;
  reactDOMClientUrl?: string;
  sampleCount: number;
  updateCount: number;
}

export const verifyUseFiberConfiguration: (
  value: unknown,
) => asserts value is UseFiberWorkerConfiguration = (value) => {
  verifyRecord(value);
  for (const name of ["react", "builtEntryUrl", "reactUrl", "reactDOMUrl"])
    assert.equal(typeof value[name], "string");
  assert.ok(value.reactDOMClientUrl === undefined || typeof value.reactDOMClientUrl === "string");
  for (const name of ["components", "sampleCount", "updateCount", "precedingHooks"]) {
    const count = value[name];
    assert.ok(
      typeof count === "number" &&
        Number.isInteger(count) &&
        count >= (name === "precedingHooks" ? 0 : 1),
    );
  }
};

export const getUseFiberFixtures = (isQuickMode: boolean) =>
  [...earlyReactVersionFixtures, ...reactVersionFixtures].filter(
    ({ label }) => !isQuickMode || label === "19",
  );

export const getUseFiberConfigurations = (isQuickMode: boolean): UseFiberConfiguration[] =>
  isQuickMode
    ? [{ components: 10, precedingHooks: 0 }]
    : [100, 1000].flatMap((components) =>
        [0, 32].map((precedingHooks) => ({ components, precedingHooks })),
      );
