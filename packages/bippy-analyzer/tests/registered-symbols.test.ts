import { expect, it } from "vite-plus/test";
import {
  createRegisteredSymbolValue,
  createSymbolValue,
  describeValue,
  getKnownObjectSymbols,
  getSymbolDescription,
  getSymbolPropertyKey,
  isSameValue,
  objectFromRecord,
  primitiveValue,
} from "../src/evaluate/values.js";
import type { StaticSymbolValue } from "../src/types.js";

it.each([
  "ordinary",
  "react.element",
  "Symbol.toStringTag",
  "Symbol.iterator",
  "#0",
  "\uE000registry:Symbol.toStringTag",
])("preserves registered symbol identity and description for %s", (key) => {
  const first = createRegisteredSymbolValue(key);
  const second = createRegisteredSymbolValue(key);
  expect(isSameValue(first, second)).toBe(true);
  expect(getSymbolDescription(first)).toBe(key);
  expect(describeValue(first)).toBe(`Symbol.for(${JSON.stringify(key)})`);
  const object = objectFromRecord({ [getSymbolPropertyKey(first)]: primitiveValue(1) });
  const symbols = getKnownObjectSymbols(object);
  expect(symbols).toHaveLength(1);
  const symbol = symbols?.[0];
  if (!symbol) throw new Error("Missing reconstructed symbol");
  expect(isSameValue(first, symbol)).toBe(true);
  expect(getSymbolDescription(symbol)).toBe(key);
});

it("separates registry keys from well-known names and allocation IDs", () => {
  const wellKnown: StaticSymbolValue = { kind: "symbol", key: "Symbol.toStringTag" };
  const allocated = createSymbolValue("Symbol.toStringTag");
  const registered = createRegisteredSymbolValue(wellKnown.key);
  const escaped = createRegisteredSymbolValue(registered.key);
  const allocationAlias = createRegisteredSymbolValue(allocated.key);
  const symbols = [wellKnown, allocated, registered, escaped, allocationAlias];
  expect(new Set(symbols.map(getSymbolPropertyKey)).size).toBe(symbols.length);
  for (const [index, first] of symbols.entries()) {
    for (const [otherIndex, second] of symbols.entries()) {
      expect(isSameValue(first, second)).toBe(index === otherIndex);
    }
  }
  expect(getSymbolDescription(allocated)).toBe("Symbol.toStringTag");
  expect(describeValue(wellKnown)).toBe("Symbol.toStringTag");
  expect(getSymbolDescription(escaped)).toBe(registered.key);
  expect(getSymbolDescription(allocationAlias)).toBe(allocated.key);
});
