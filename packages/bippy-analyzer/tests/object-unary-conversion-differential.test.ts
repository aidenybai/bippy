import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkSymbolicCases,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";
interface UnaryConversionCase {
  name: string;
  initializer: string;
}
const conversions: UnaryConversionCase[] = [
  {
    name: "number valueOf",
    initializer:
      "{marker:'input',valueOf(){trace.push('valueOf:'+this.marker+':'+arguments.length);return firstValue?7:-0;}}",
  },
  {
    name: "bigint valueOf",
    initializer: "{valueOf(){trace.push('valueOf');return firstValue?7n:-2n;}}",
  },
  {
    name: "symbol result",
    initializer: "{valueOf(){trace.push('valueOf');return Symbol('entry');}}",
  },
  {
    name: "nullish result",
    initializer: "{valueOf(){trace.push('valueOf');return firstValue?null:undefined;}}",
  },
  {
    name: "string result",
    initializer: "{valueOf(){trace.push('valueOf');return firstValue?'-0':'nope';}}",
  },
  {
    name: "exotic hint",
    initializer:
      "{marker:'input',[Symbol.toPrimitive](hint){trace.push('exotic:'+hint+':'+this.marker+':'+arguments.length);return firstValue?7n:'-0';}}",
  },
  {
    name: "selected exotic getter",
    initializer:
      "{get [Symbol.toPrimitive](){trace.push('get:exotic');return firstValue?function(){trace.push('first');return 7;}:function(){trace.push('second');return -0;};}}",
  },
  {
    name: "live ordinary fallback",
    initializer:
      "{valueOf(){trace.push('valueOf');this.toString=()=>{trace.push('replacement');return '7';};return {};},toString(){trace.push('old');return '9';}}",
  },
  {
    name: "exotic getter throws",
    initializer: "{get [Symbol.toPrimitive](){trace.push('get:exotic');throw 'lookup';}}",
  },
  {
    name: "ordinary call throws",
    initializer: "{valueOf(){trace.push('valueOf');throw 'convert';}}",
  },
  { name: "invalid exotic method", initializer: "{[Symbol.toPrimitive]:firstValue?1:'bad'}" },
  {
    name: "exotic returns function",
    initializer: "{[Symbol.toPrimitive](){trace.push('exotic');return ()=>7;}}",
  },
  {
    name: "inherited conversion",
    initializer:
      "Object.create({marker:'inherited',valueOf(){trace.push('valueOf:'+this.marker);return firstValue?7n:8;}})",
  },
  { name: "plain object", initializer: "{}" },
  { name: "null prototype", initializer: "Object.create(null)" },
];
const cases: DifferentialCase[] = conversions.flatMap((conversion) =>
  ["+", "-", "~", "!", "void", "typeof"].flatMap((operator) =>
    [false, true].map((isSelected) => ({
      name: `${conversion.name}/${operator}/selected=${isSelected}`,
      body: `const firstValue=first;const secondValue=second;const trace=[];const candidate=${conversion.initializer};const getOperand=()=>{trace.push('operand');return ${isSelected ? "secondValue?candidate:2" : "candidate"};};try{const result=${operator} getOperand();trace.push('after:'+typeof result+':'+(Object.is(result,-0)?'-0':String(result)));}catch(error){trace.push(typeof error==='string'?error:error.name+':'+error.message);}return trace.join('|')+':'+(firstValue?'A':'B')+':'+(secondValue?'A':'B');`,
    })),
  ),
);
it.each(cases)("matches native unary object conversion and replay: $name", (testCase) =>
  checkSymbolicCases([testCase]),
);
it.each(cases)("matches all concrete unary object inputs: $name", (testCase) =>
  checkDifferentialCases(
    Array.from({ length: 4 }, (_value, index) => ({
      name: `${testCase.name}/assignment=${index}`,
      body: `const first=${!!(index & 2)};const second=${!!(index & 1)};${testCase.body}`,
    })),
  ),
);
