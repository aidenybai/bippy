import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import { checkDifferentialCases } from "./helpers/differential-evaluator.js";

interface LiteralConsumer {
  name: string;
  getExpression: (length: number) => string;
  isTagged?: boolean;
}

const getItems = (length: number): string[] =>
  Array.from({ length }, (_value, index) => `evaluate(${index})`);
const getTemplate = (length: number): string =>
  "`" +
  getItems(length)
    .map((item) => "${" + item + "}")
    .join("") +
  "`";
const consumers: LiteralConsumer[] = [
  { name: "array", getExpression: (length) => `[${getItems(length).join(",")}]` },
  {
    name: "object",
    getExpression: (length) =>
      `({ ${getItems(length)
        .map((item, index) => `field${index}: ${item}`)
        .join(",")} })`,
  },
  { name: "template", getExpression: getTemplate },
  {
    name: "tagged-template",
    getExpression: (length) => `tag${getTemplate(length)}`,
    isTagged: true,
  },
];

const cases = consumers.flatMap((consumer) =>
  Array.from({ length: 5 }, (_value, index) => index + 1).flatMap((length) =>
    Array.from({ length: length + 1 }, (_value, throwIndex) => {
      const isThrowing = throwIndex < length;
      const prefix = Array.from(
        { length: isThrowing ? throwIndex + 1 : length },
        (_item, index) => `step:${index}`,
      );
      if (!isThrowing && consumer.isTagged) prefix.push("tag");
      prefix.push(isThrowing ? "caught:true" : "done");
      const name = `${consumer.name}/length=${length}/throw=${throwIndex}`;
      return {
        name,
        expected: prefix.join("|"),
        body: `const trace = []; const token = {}; const evaluate = (index) => { trace.push('step:' + index); if (index === ${throwIndex}) throw token; return index; }; const tag = () => { trace.push('tag'); return 7; }; try { ${consumer.getExpression(length)}; trace.push('done'); } catch (error) { trace.push('caught:' + Object.is(error, token)); } return trace.join('|');`,
      };
    }),
  ),
);

it.each(cases)("$name", async ({ name, body, expected }) => {
  expect(runInNewContext(`"use strict"; (() => { ${body} })()`, {}, { timeout: 1000 })).toBe(
    expected,
  );
  await checkDifferentialCases([{ name, body }]);
});
