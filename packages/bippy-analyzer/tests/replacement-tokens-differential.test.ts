import { it } from "vite-plus/test";
import { checkDifferentialCases } from "./helpers/differential-evaluator.js";

const patterns = [
  "/a/g",
  "/(a)(b)?/g",
  "/(a)?b/g",
  "/(?:)/gu",
  "/(?<letter>a)(?<optional>b)?/g",
  "'a'",
  "''",
];
const texts = ["", "a", "ab", "baab", "😀a😀", "\ud800a", "$a\n"];
const replacements = [
  "",
  "$$",
  "$&",
  "$`",
  "$'",
  "$1-$2",
  "$01/$10",
  "$0/$99",
  "$<letter>:$<optional>",
  "$<missing>",
];

it.each(patterns)("matches exhaustive native replacement token matrix for %s", (pattern) =>
  checkDifferentialCases(
    texts.flatMap((text) =>
      replacements.map((replacement) => ({
        name: `${pattern}/${JSON.stringify(text)}/${JSON.stringify(replacement)}`,
        body: `const text = ${JSON.stringify(text)}; const replacement = ${JSON.stringify(replacement)}; const pattern = ${pattern}; return JSON.stringify([text.replace(pattern, replacement), text.replaceAll(pattern, replacement)]);`,
      })),
    ),
  ),
);
