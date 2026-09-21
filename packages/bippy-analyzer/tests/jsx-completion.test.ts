import { it } from "vite-plus/test";
import { checkGuardedCases, checkSymbolicCases } from "./helpers/differential-evaluator.js";

const cases = ["type", "spread", "prop", "child", "tail", "none"].map((failureStage) => ({
  name: `throw at ${failureStage}`,
  jsx: true,
  body: `const trace = []; const record = (stage) => { trace.push(stage); if (first && stage === ${JSON.stringify(failureStage)}) throw second ? "second" : "first"; return stage; };
    const View = () => { throw "unused component rendered"; };
    const owner = { get View() { record("type"); return View; } };
    const source = { get title() { return record("spread"); } };
    try { void <owner.View {...source} title={record("prop")}>{record("child")}{record("tail")}</owner.View>; trace.push("done"); }
    catch (error) { trace.push(error); } return trace.join(",");`,
}));
cases.push(
  {
    name: "fragment children stop at a conditional throw",
    jsx: true,
    body: `const trace = []; const read = () => { trace.push("read"); if (first) throw second ? "second" : "first"; return "value"; };
      try { void <>{read()}{trace.push("tail")}</>; } catch (error) { trace.push(error); }
      return trace.join(",");`,
  },
  {
    name: "conditional element types evaluate their arguments once per path",
    jsx: true,
    body: `let calls = 0; const Left = () => null; const Right = () => null; const Selected = first ? Left : Right;
      void <Selected title={++calls}>{++calls}</Selected>; return String(calls);`,
  },
);

it.each(cases)("preserves JSX execution and completion: $name", async (testCase) => {
  await checkGuardedCases([testCase]);
  await checkSymbolicCases([testCase]);
});
