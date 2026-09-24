import { it } from "vite-plus/test";
import { checkExpectedDifferentialCases } from "./helpers/differential-evaluator.js";

interface ConversionFailure {
  index: number;
  field: string;
}

const names = ["alpha", "beta", "gamma"];
const fields = ["enumerable", "configurable", "value", "writable"];
const cases = [false, true].flatMap((hasOuterGetter) => {
  const phases = hasOuterGetter ? ["descriptor", ...fields] : fields;
  const failures: ConversionFailure[] = [
    { index: -1, field: "none" },
    ...[0, 1, 2].flatMap((index) => phases.map((field) => ({ index, field }))),
  ];
  return failures.flatMap((failure) =>
    [false, true].map((isStaged) => {
      const expectedTrace: string[] = [];
      for (let index = 0; index < 3; index++) {
        for (const field of phases) {
          expectedTrace.push(`${index}:${field}:0`);
          if (index === failure.index && field === failure.field) break;
        }
        if (index === failure.index) break;
      }
      expectedTrace.push(failure.index === -1 ? "after" : "caught:true");
      const descriptorEntries = names.map((name, index) =>
        hasOuterGetter
          ? `get ${name}() { read(${index}, 'descriptor', undefined); return createDescriptor(${index}); }`
          : `${name}: createDescriptor(${index})`,
      );
      return {
        name: `outer=${hasOuterGetter}/index=${failure.index}/field=${failure.field}/staged=${isStaged}`,
        expected:
          expectedTrace.join("|") +
          "#" +
          (failure.index === -1 ? "true,true,true" : "false,false,false"),
        body: `const trace = []; const token = {}; const target = {}; const names = ['alpha', 'beta', 'gamma']; const read = (index, field, value) => { trace.push(index + ':' + field + ':' + Object.keys(target).length); if (index === ${failure.index} && field === ${JSON.stringify(failure.field)}) throw token; return value; }; const createDescriptor = (index) => ({ get enumerable() { return read(index, 'enumerable', true); }, get configurable() { return read(index, 'configurable', true); }, get value() { return read(index, 'value', index + 7); }, get writable() { return read(index, 'writable', true); } }); const descriptors = { ${descriptorEntries.join(",")} }; try { ${isStaged ? "const normalized = {}; for (const name of names) { const descriptor = descriptors[name]; const enumerable = descriptor.enumerable; const configurable = descriptor.configurable; const value = descriptor.value; const writable = descriptor.writable; normalized[name] = { enumerable, configurable, value, writable }; } Object.defineProperties(target, normalized);" : "Object.defineProperties(target, descriptors);"} trace.push('after'); } catch (error) { trace.push('caught:' + (error === token)); } return trace.join('|') + '#' + names.map((name) => Object.hasOwn(target, name)).join(',');`,
      };
    }),
  );
});

it.each(cases)("preserves conversion completion: $name", (testCase) =>
  checkExpectedDifferentialCases([testCase]),
);

const commitCases = ["readonly", "nonextensible"].flatMap((mode) =>
  [0, 1, 2].flatMap((failureIndex) =>
    [false, true].map((isFailing) => {
      const initialDefinitions = names
        .filter((_name, index) => mode === "readonly" || index !== failureIndex)
        .map(
          (name) =>
            `Object.defineProperty(target, ${JSON.stringify(name)}, { value: 0, enumerable: true, writable: ${mode !== "readonly" || name !== names[failureIndex]}, configurable: ${mode !== "readonly" || name !== names[failureIndex]} });`,
        );
      const patches = names
        .filter((_name, index) => mode === "readonly" || isFailing || index !== failureIndex)
        .map(
          (name) =>
            `${name}: { value: ${mode === "readonly" && !isFailing ? 0 : 7}, writable: ${mode !== "readonly"}, configurable: ${mode !== "readonly"}, enumerable: true }`,
        );
      const values = names.map((_name, index) =>
        mode === "nonextensible" && index === failureIndex
          ? "_"
          : !isFailing
            ? mode === "readonly"
              ? "0"
              : "7"
            : index < failureIndex
              ? "7"
              : "0",
      );
      return {
        name: `${mode}/index=${failureIndex}/failing=${isFailing}`,
        expected: `${isFailing ? "TypeError" : "after"}#${values.join(",")}`,
        body: `const target = {}; ${initialDefinitions.join(" ")} ${mode === "nonextensible" ? "Object.preventExtensions(target);" : ""} let outcome = 'after'; try { Object.defineProperties(target, { ${patches.join(",")} }); } catch (error) { outcome = error.name; } return outcome + '#' + ['alpha', 'beta', 'gamma'].map((name) => Object.hasOwn(target, name) ? String(target[name]) : '_').join(',');`,
      };
    }),
  ),
);

it.each(commitCases)("preserves definition completion: $name", (testCase) =>
  checkExpectedDifferentialCases([testCase]),
);
