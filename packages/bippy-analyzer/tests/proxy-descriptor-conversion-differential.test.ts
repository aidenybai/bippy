import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
} from "./helpers/differential-evaluator.js";
import { propertyDefinitionMethods } from "./helpers/property-definition-methods.js";

interface DescriptorShape {
  name: string;
  source: string;
  fields: string[];
}

const fieldNames = ["enumerable", "configurable", "value", "writable", "get", "set"];
const shapes: DescriptorShape[] = [
  {
    name: "data",
    source: "{ writable: true, value: 7, configurable: true, enumerable: true }",
    fields: ["enumerable", "configurable", "value", "writable"],
  },
  {
    name: "accessor",
    source: "{ set: () => {}, get: () => 7, configurable: true, enumerable: true }",
    fields: ["enumerable", "configurable", "get", "set"],
  },
  { name: "generic", source: "{}", fields: [] },
];
const cases = shapes
  .flatMap((shape) => {
    const events = fieldNames.flatMap((field) => [
      `has:${field}:true:true`,
      ...(shape.fields.includes(field) ? [`get:${field}:true:true:true`] : []),
    ]);
    return Array.from({ length: events.length + 1 }, (_value, failureStep) =>
      [
        ...propertyDefinitionMethods.map((method) => ({ ...method, isStaged: false })),
        { ...propertyDefinitionMethods[0], name: "explicit-staging", isStaged: true },
      ].map((method) => ({
        name: `${shape.name}/${method.name}/failure=${failureStep}`,
        label: `${method.isStaged ? "" : "known divergence: "}${shape.name}/${method.name}/failure=${failureStep}`,
        isStaged: method.isStaged,
        expected:
          [
            ...(failureStep === 0 ? events : events.slice(0, failureStep)),
            failureStep === 0 ? "after" : "caught:true",
          ].join("|") +
          "#" +
          (failureStep === 0),
        body: `const trace = []; const token = {}; const fields = ${shape.source}; let target = {}; const record = (event) => { trace.push(event); if (trace.length === ${failureStep}) throw token; }; const handler = { has(innerTarget, key) { record('has:' + key + ':' + (this === handler) + ':' + (innerTarget === fields)); return key in innerTarget; }, get(innerTarget, key, receiver) { record('get:' + key + ':' + (this === handler) + ':' + (innerTarget === fields) + ':' + (receiver === proxyDescriptor)); return innerTarget[key]; } }; const proxyDescriptor = new Proxy(fields, handler); try { ${method.isStaged ? `const descriptor = {}; for (const key of ${JSON.stringify(fieldNames)}) { const isPresent = handler.has.call(handler, fields, key); if (isPresent) { const value = handler.get.call(handler, fields, key, proxyDescriptor); descriptor[key] = value; } }` : "const descriptor = proxyDescriptor;"} ${method.statement} trace.push('after'); } catch (error) { trace.push('caught:' + (error === token)); } return trace.join('|') + '#' + Object.hasOwn(target, 'entry');`,
      })),
    );
  })
  .flat();

it.each(cases)("$label", async ({ name, body, expected, isStaged }) => {
  expect(runInNewContext(`"use strict"; (() => { ${body} })()`, {}, { timeout: 1000 })).toBe(
    expected,
  );
  if (isStaged) await checkDifferentialCases([{ name, body }]);
  else await checkKnownDifferentialWitnesses([{ name, body, expected, actual: '"after#false"' }]);
});
