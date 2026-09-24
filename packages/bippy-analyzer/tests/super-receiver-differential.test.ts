import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
  createSeededRandom,
  differentialSeeds,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

it.each(differentialSeeds)(
  "matches inherited methods with explicit receivers, seed %i",
  async (seed) => {
    const getRandom = createSeededRandom(seed);
    const cases: DifferentialCase[] = [];
    for (let index = 0; index < 30; index++) {
      const initial = getRandom(30);
      const increment = 1 + getRandom(30);
      cases.push({
        name: `seed=${seed}/case=${index}`,
        body: `
      const trace = [];
      class Base { read(value) { trace.push(this.value + ':' + value); return this.value + value; } }
      class Child extends Base {
        value = ${initial};
        read(value) { return super.read(value) + 1; }
        createReader() { return (value) => super.read(value); }
      }
      const instance = new Child();
      const first = instance.read(${increment});
      const read = instance.createReader(); instance.value++;
      const second = read(${increment + 1});
      const third = instance.read.call({ value: ${initial + 2} }, ${increment + 2});
      return trace.join('|') + '#' + first + ':' + second + ':' + third;
    `,
      });
    }
    await checkDifferentialCases(cases);
  },
);

it.each([
  {
    name: "super getters receive the actual method receiver",
    body: `class Base { get value() { return this.stored; } } class Child extends Base { read() { return super.value; } } return new Child().read.call({ stored: 7 });`,
  },
  {
    name: "super methods retain their home object when borrowed",
    body: `class Base { read() { return this.value; } } class Child extends Base { read() { return super.read() + 1; } } return new Child().read.call({ value: 7 });`,
  },
  {
    name: "a detached super method does not retain a receiver",
    body: `class Base { read() { return this.value; } } class Child extends Base { getReader() { return super.read; } } const read = new Child().getReader(); try { return read(); } catch (error) { return error.name; }`,
  },
  {
    name: "super getter lookup precedes call arguments",
    body: `const trace = []; class Base { get callable() { trace.push('get'); return (value) => value; } } class Child extends Base { run() { return super.callable((trace.push('argument'), 7)); } } const result = new Child().run(); return trace.join('|') + ':' + result;`,
  },
  {
    name: "throwing super getter lookup skips call arguments",
    body: `const trace = []; class Base { get callable() { trace.push('get'); throw 'getter'; } } class Child extends Base { run() { return super.callable((trace.push('argument'), 7)); } } try { new Child().run(); trace.push('accepted'); } catch (error) { trace.push('caught:' + error); } return trace.join('|');`,
  },
])("preserves $name", (testCase) => checkDifferentialCases([testCase]));

it.each([
  {
    name: "super setters receive the actual method receiver",
    expected: "receiver:7:7",
    actual: '":undefined"',
    body: `const trace = []; class Base { set value(value) { trace.push(this.marker + ':' + value); this.stored = value; } } class Child extends Base { write(value) { super.value = value; } } const receiver = { marker: 'receiver' }; new Child().write.call(receiver, 7); return trace.join('|') + ':' + receiver.stored;`,
  },
  {
    name: "super data assignment writes to the receiver rather than a base object",
    expected: "7:1",
    actual: '"1:1"',
    body: `class Base {} Base.prototype.value = 1; class Child extends Base { write(value) { super.value = value; } } const instance = new Child(); instance.write(7); return instance.value + ':' + Base.prototype.value;`,
  },
  {
    name: "computed super assignment keys precede the right-hand side",
    expected: "key|right|set:7",
    actual: '"key|right"',
    body: `const trace = []; class Base { set value(value) { trace.push('set:' + value); } } class Child extends Base { run() { super[(trace.push('key'), 'value')] = (trace.push('right'), 7); } } new Child().run(); return trace.join('|');`,
  },
])("known divergence: $name", (testCase) => checkKnownDifferentialWitnesses([testCase]));
