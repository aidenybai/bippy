import { it } from "vite-plus/test";
import { checkExpectedDifferentialCases } from "./helpers/differential-evaluator.js";

interface DescriptorPatch {
  name: string;
  isAccessor: boolean;
  source: string;
  expectedFields: string;
}

const patches: DescriptorPatch[] = [
  {
    name: "generic-data-update",
    isAccessor: false,
    source: "{}",
    expectedFields: "true:false:false:false:false",
  },
  {
    name: "generic-accessor-update",
    isAccessor: true,
    source: "{}",
    expectedFields: "false:true:true:false:false",
  },
  {
    name: "accessor-to-data-value",
    isAccessor: true,
    source: "{ value: 19 }",
    expectedFields: "true:false:false:false:false",
  },
  {
    name: "accessor-to-data-writable",
    isAccessor: true,
    source: "{ writable: true }",
    expectedFields: "true:false:false:false:false",
  },
  {
    name: "data-to-accessor-getter",
    isAccessor: false,
    source: "{ get: replacementGetter }",
    expectedFields: "false:false:false:true:false",
  },
  {
    name: "data-to-accessor-setter",
    isAccessor: false,
    source: "{ set: replacementSetter }",
    expectedFields: "false:false:false:false:true",
  },
  {
    name: "accessor-replace-getter",
    isAccessor: true,
    source: "{ get: replacementGetter }",
    expectedFields: "false:false:true:true:false",
  },
  {
    name: "accessor-replace-setter",
    isAccessor: true,
    source: "{ set: replacementSetter }",
    expectedFields: "false:true:false:false:true",
  },
];

const cases = patches.flatMap((patch) =>
  [false, true].flatMap((enumerable) =>
    [false, true].map((isSymbol) => ({
      name: `${patch.name}/enumerable=${enumerable}/symbol=${isSymbol}`,
      expected: `${enumerable}:${patch.expectedFields}`,
      body: `
    const target = {}; const key = ${isSymbol ? "Symbol('value')" : "'value'"};
    const getter = () => 7; const setter = (value) => {}; const replacementGetter = () => 19; const replacementSetter = (value) => {};
    Object.defineProperty(target, key, { ${patch.isAccessor ? "get: getter, set: setter," : "value: 7, writable: true,"} configurable: true, enumerable: ${enumerable} });
    Object.defineProperty(target, key, ${patch.source});
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    return descriptor.enumerable + ':' + ('value' in descriptor) + ':' + (descriptor.get === getter) + ':' + (descriptor.set === setter) + ':' + (descriptor.get === replacementGetter) + ':' + (descriptor.set === replacementSetter);
  `,
    })),
  ),
);

it.each(cases)("preserves partial descriptor $name", (testCase) =>
  checkExpectedDifferentialCases([testCase]),
);
