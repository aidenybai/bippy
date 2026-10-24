import type { InstructionId, SourceLocation } from "../react-compiler/HIR/HIR";
import type { Interpreter } from "./interpret";
import { UNDEFINED_VALUE, createUnknown, foldBinary } from "./symbolic-values";
import type { SymbolicValue } from "./types";
import { getValueKey } from "./utils/get-value-key";
import { negate } from "./utils/negate";
import type { WalkState } from "./walk-state";

const MATCH_MODULE = "ts-pattern";
const PASSTHROUGH_METHODS = new Set(["returnType", "narrow"]);
const CLOSING_METHODS = new Set(["exhaustive", "run"]);

interface MatchArm {
  tests: SymbolicValue[];
  handler: SymbolicValue;
}

interface MatchChain {
  subject: SymbolicValue;
  arms: MatchArm[];
}

interface MatchSite {
  loc: SourceLocation;
  instructionId: InstructionId;
  walkState: WalkState;
}

const isMatchCallee = (callee: SymbolicValue): boolean =>
  callee.kind === "Global" && callee.name === "match" && callee.module === MATCH_MODULE;

const withGuards = (site: MatchSite, guards: SymbolicValue[]): MatchSite => ({
  ...site,
  walkState: { ...site.walkState, guards: [...site.walkState.guards, ...guards] },
});

export class PatternMatcher {
  readonly #interpreter: Interpreter;
  readonly #chains = new WeakMap<SymbolicValue, MatchChain>();

  constructor(interpreter: Interpreter) {
    this.#interpreter = interpreter;
  }

  start(
    callee: SymbolicValue,
    argumentValues: SymbolicValue[],
    loc: SourceLocation,
  ): SymbolicValue | null {
    if (!isMatchCallee(callee)) return null;
    const [subject] = argumentValues;
    return this.#extend({ subject: subject ?? UNDEFINED_VALUE, arms: [] }, [], loc);
  }

  continue(
    receiver: SymbolicValue,
    methodName: string,
    argumentValues: SymbolicValue[],
    site: MatchSite,
  ): SymbolicValue | null {
    const chain = this.#chains.get(receiver);
    if (!chain) return null;
    if (PASSTHROUGH_METHODS.has(methodName)) return this.#extend(chain, [], site.loc);
    if (methodName === "with")
      return this.#extend(chain, this.#getArms(chain.subject, argumentValues, site.loc), site.loc);
    if (methodName === "when") {
      const handler = argumentValues[1];
      const tests = [createUnknown("predicate", site.loc)];
      return handler ? this.#extend(chain, [{ tests, handler }], site.loc) : null;
    }
    if (methodName === "otherwise") return this.#build(chain, 0, argumentValues[0] ?? null, site);
    if (CLOSING_METHODS.has(methodName)) return this.#build(chain, 0, null, site);
    return null;
  }

  #extend(chain: MatchChain, arms: MatchArm[], loc: SourceLocation): SymbolicValue {
    const result = createUnknown("match", loc);
    this.#chains.set(result, { subject: chain.subject, arms: [...chain.arms, ...arms] });
    return result;
  }

  #getArms(
    subject: SymbolicValue,
    argumentValues: SymbolicValue[],
    loc: SourceLocation,
  ): MatchArm[] {
    const handler = argumentValues.at(-1);
    const patterns = argumentValues.slice(0, -1);
    if (!handler || patterns.length === 0) return [];
    return patterns.map((pattern) => ({
      tests: this.#getPatternTests(subject, pattern, loc),
      handler,
    }));
  }

  #getPatternTests(
    subject: SymbolicValue,
    pattern: SymbolicValue,
    loc: SourceLocation,
  ): SymbolicValue[] {
    const isObjectPattern =
      pattern.kind === "ObjectExpression" &&
      pattern.spreads.length === 0 &&
      pattern.properties.length > 0;
    if (isObjectPattern)
      return pattern.properties.flatMap((property) =>
        this.#getPatternTests(
          this.#interpreter.evaluatePropertyLoad(subject, property.key, loc),
          property.value,
          loc,
        ),
      );
    if (pattern.kind !== "Primitive") return [createUnknown("pattern", loc)];
    if (pattern.value === true) return [subject];
    if (pattern.value === false) return [negate(subject)];
    return [foldBinary("===", subject, pattern)];
  }

  #build(
    chain: MatchChain,
    index: number,
    fallback: SymbolicValue | null,
    site: MatchSite,
  ): SymbolicValue {
    const arm = chain.arms[index];
    if (!arm)
      return fallback
        ? this.#callHandler(fallback, chain.subject, site)
        : createUnknown("match", site.loc);
    const isUnconditionalLast = index === chain.arms.length - 1 && !fallback;
    if (isUnconditionalLast) return this.#callHandler(arm.handler, chain.subject, site);
    const [firstTest] = arm.tests;
    const restGuards = arm.tests.length === 1 && firstTest ? [negate(firstTest)] : [];
    const rest = this.#build(chain, index + 1, fallback, withGuards(site, restGuards));
    return this.#nest(arm, 0, rest, chain.subject, site);
  }

  #nest(
    arm: MatchArm,
    testIndex: number,
    rest: SymbolicValue,
    subject: SymbolicValue,
    site: MatchSite,
  ): SymbolicValue {
    const test = arm.tests[testIndex];
    if (!test) return this.#callHandler(arm.handler, subject, site);
    return {
      kind: "Conditional",
      test,
      testKind: "truthy",
      consequent: this.#nest(arm, testIndex + 1, rest, subject, withGuards(site, [test])),
      alternate: rest,
      branch: this.#interpreter.createBranch(site.instructionId, site.loc, "none"),
      guardKeys: site.walkState.guards.map(getValueKey),
    };
  }

  #callHandler(handler: SymbolicValue, subject: SymbolicValue, site: MatchSite): SymbolicValue {
    return handler.kind === "Function"
      ? this.#interpreter.callFunction(handler, [subject], site.loc, site.walkState)
      : createUnknown("match", site.loc);
  }
}
