import { describe, it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

interface ParameterPattern {
  name: string;
  source: string;
  failingArgument: string;
  validArgument: string;
}

interface CallableForm {
  name: string;
  declare: (parameters: string) => string;
  invoke: string;
}

const patterns: ParameterPattern[] = [
  { name: "default", source: "value = fail()", failingArgument: "undefined", validArgument: "7" },
  {
    name: "getter",
    source: "{ value }",
    failingArgument: "({ get value() { return fail(); } })",
    validArgument: "({ value: 7 })",
  },
  {
    name: "nested default",
    source: "{ inner: { value = fail() } }",
    failingArgument: "({ inner: {} })",
    validArgument: "({ inner: { value: 7 } })",
  },
];
const forms: CallableForm[] = [
  {
    name: "arrow",
    declare: (parameters) => `const invoke = (${parameters}) => { mark('body'); };`,
    invoke: "invoke",
  },
  {
    name: "method",
    declare: (parameters) => `const holder = { invoke(${parameters}) { mark('body'); } };`,
    invoke: "holder.invoke",
  },
  {
    name: "constructor",
    declare: (parameters) =>
      `class Target { field = mark('field'); constructor(${parameters}) { mark('body'); } }`,
    invoke: "new Target",
  },
];

const createParameterCase = (
  pattern: ParameterPattern,
  form: CallableForm,
  shouldFail: boolean,
): DifferentialCase => ({
  name: `${form.name}/${pattern.name}`,
  body: `
    const trace = [];
    const mark = (name) => { trace.push(name); return name; };
    const fail = () => { trace.push('fail'); throw 'stop'; };
    ${form.declare(`${pattern.source}, later = mark('later'), extra`)}
    try { ${form.invoke}(${shouldFail ? pattern.failingArgument : pattern.validArgument}, undefined, mark('argument')); trace.push('returned'); }
    catch (error) { trace.push('caught:' + error); }
    return trace.join('|');
  `,
});

describe.each(
  forms.flatMap((form) =>
    patterns.map((pattern) => ({ form, pattern, name: `${form.name}/${pattern.name}` })),
  ),
)("parameter completion: $name", ({ form, pattern }) => {
  it("known divergence: stops later parameters and the body after binding throws", () => {
    const prefix = form.name === "constructor" ? "argument|field|fail" : "argument|fail";
    return checkKnownDifferentialWitnesses([
      {
        ...createParameterCase(pattern, form, true),
        expected: `${prefix}|caught:stop`,
        actual: JSON.stringify(`${prefix}|later|body|returned`),
      },
    ]);
  });
  it("preserves argument, parameter and body order when binding succeeds", () =>
    checkDifferentialCases([createParameterCase(pattern, form, false)]));
});

describe.each([
  {
    name: "later parameter hides an outer binding during its TDZ",
    expected: "ReferenceError",
    actual: "99",
    body: `const later = 99; const invoke = (value = later, later = 1) => value; try { return invoke(); } catch (error) { return error.name; }`,
  },
  {
    name: "self-referential parameter is uninitialized",
    expected: "ReferenceError",
    actual: "99",
    body: `const value = 99; const invoke = (value = value) => value; try { return invoke(); } catch (error) { return error.name; }`,
  },
  {
    name: "default closures do not capture body var bindings",
    expected: 9,
    actual: "1",
    body: `const outer = 9; const invoke = (read = () => outer) => { var outer = 1; return read(); }; return invoke();`,
  },
  {
    name: "immediate defaults read the outer binding before body initialization",
    body: `const outer = 9; const invoke = (value = outer) => { var outer = 1; return value; }; return invoke();`,
  },
  {
    name: "argument exceptions prevent parameter evaluation",
    body: `const trace = []; const mark = (name) => { trace.push(name); return name; }; const fail = () => { trace.push('fail'); throw 'stop'; }; const invoke = (value = mark('parameter')) => mark('body'); try { invoke(fail(), mark('later argument')); } catch (error) { trace.push('caught:' + error); } return trace.join('|');`,
  },
])("parameter scope: $name", ({ name, body, expected, actual }) => {
  it(
    actual === undefined
      ? "matches native scope and completion"
      : "known divergence: preserves parameter scope isolation",
    () =>
      actual === undefined
        ? checkDifferentialCases([{ name, body }])
        : checkKnownDifferentialWitnesses([{ name, body, expected, actual }]),
  );
});

it("known divergence: rejects an async call whose parameter default throws before entering the body", () =>
  checkKnownDifferentialWitnesses(
    [
      {
        name: "async parameter failure",
        expected: "fail|sync|error:stop",
        actual: JSON.stringify("fail|later|body|sync|ok:7"),
        body: `const trace = []; const fail = () => { trace.push('fail'); throw 'stop'; }; const invoke = async (value = fail(), later = (trace.push('later'), 1)) => { trace.push('body'); return 7; }; invoke().then((value) => trace.push('ok:' + value), (error) => trace.push('error:' + error)); trace.push('sync'); return () => trace.join('|');`,
      },
    ],
    true,
  ));
