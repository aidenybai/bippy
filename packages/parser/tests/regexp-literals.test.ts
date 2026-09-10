import { describe, expect, it } from "vite-plus/test";
import {
  getRequiredCharacters,
  mayContainText,
  mayRegExpMatch,
} from "../src/evaluate/regexp-literals.js";

const required = (regExp: RegExp): string[] | null => {
  const characters = getRequiredCharacters(regExp);
  return characters && [...characters].sort();
};

describe("required characters of a RegExp", () => {
  it("collects the literals every match contains", () => {
    expect(required(/<\/?[a-z][^>]*>/)).toEqual([">", "<"].sort());
    expect(required(/\{\{(\w+)\}\}/)).toEqual(["{", "}"]);
    expect(required(/^https?:\/\//)).toEqual([":", "/", "h", "p", "t"].sort());
    expect(required(/\x41\u0042\u{43}\n/u)).toEqual(["\n", "A", "B", "C"]);
  });

  it("drops what a quantifier, class, wildcard or lookaround may leave out", () => {
    expect(required(/a?b*c{0,3}d{2}e+/)).toEqual(["d", "e"]);
    expect(required(/[abc]\d\s\w./)).toEqual([]);
    expect(required(/(?=x)(?!y)(?<=z)q/)).toEqual(["q"]);
    expect(required(/\bword\b/)).toEqual(["d", "o", "r", "w"]);
    expect(required(/(a)\1/)).toEqual(["a"]);
  });

  it("keeps only what every alternative shares", () => {
    expect(required(/ab|ac/)).toEqual(["a"]);
    expect(required(/(?:x|y)z/)).toEqual(["z"]);
    expect(required(/(?<name>ab)|b/)).toEqual(["b"]);
  });

  it("gives up on Unicode set patterns", () => {
    expect(required(/[\p{L}]/v)).toBeNull();
  });
});

describe("whether a bounded alphabet can match", () => {
  const alphabet = new Set("© 0123456789.+-eInfinityNaN Acme, all rights reserved.");

  it("rules out patterns needing absent literals", () => {
    expect(mayRegExpMatch(/<\/?[a-z][^>]*>/i, alphabet)).toBe(false);
    expect(mayRegExpMatch(/\{\{(\w+)\}\}/, alphabet)).toBe(false);
    expect(mayRegExpMatch(/reserved/, alphabet)).toBe(true);
    expect(mayRegExpMatch(/\d+/, alphabet)).toBe(true);
    expect(mayContainText("<0>", alphabet)).toBe(false);
    expect(mayContainText("rights", alphabet)).toBe(true);
    expect(mayContainText("", alphabet)).toBe(true);
  });

  it("folds case as the pattern's flags do", () => {
    expect(mayRegExpMatch(/ACME/i, alphabet)).toBe(true);
    expect(mayRegExpMatch(/ACME/, alphabet)).toBe(false);
    expect(mayRegExpMatch(/BETA/i, alphabet)).toBe(false);
    expect(mayRegExpMatch(/k/iu, new Set("\u212a"))).toBe(true);
    expect(mayRegExpMatch(/k/i, new Set("\u212a"))).toBe(false);
    expect(mayRegExpMatch(/k/, new Set("\u212a"))).toBe(false);
  });
});
