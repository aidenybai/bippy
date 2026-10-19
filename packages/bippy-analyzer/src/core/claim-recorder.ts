import type { SourceLocation } from "../react-compiler/HIR/HIR";
import {
  CLAIM_FUNCTIONS,
  createCastClaim,
  createNonNullClaim,
  describeCondition,
  hasNullishCase,
} from "./claim-sites";
import { hasUnknownPart } from "./constraints";
import type { InstructionValueOfKind, Interpreter } from "./interpret";
import { createUnknown } from "./symbolic-values";
import type { Claim, Domain, SymbolicValue } from "./types";
import { forEachSymbolicValue } from "./utils/for-each-symbolic-value";
import { getValuePlace } from "./utils/get-value-place";
import type { WalkState } from "./walk-state";

const isLiteralDomain = (domain: Domain): boolean =>
  domain.kind === "Cases" && domain.cases.every((value) => value.kind === "Literal");

export class ClaimRecorder {
  readonly #interpreter: Interpreter;
  readonly #claims: Claim[] = [];

  constructor(interpreter: Interpreter) {
    this.#interpreter = interpreter;
  }

  get claims(): Claim[] {
    return this.#claims;
  }

  evaluateTypeCast(
    typeCast: InstructionValueOfKind<"TypeCastExpression">,
    walkState: WalkState,
  ): SymbolicValue {
    const castValue = this.#interpreter.read(typeCast.value);
    const sourceDomain = this.#interpreter.resolver.getDomain(typeCast.value.loc);
    if (typeCast.typeAnnotationKind === "non-null") {
      if (hasNullishCase(sourceDomain))
        this.record(createNonNullClaim(castValue, typeCast.loc, walkState.guards));
      return castValue;
    }
    const targetDomain = this.#interpreter.resolver.getDomain(typeCast.loc);
    const claim = createCastClaim(
      castValue,
      sourceDomain,
      targetDomain,
      typeCast.loc,
      walkState.guards,
    );
    if (claim) this.record(claim);
    const isUntypedCast = castValue.kind === "Unknown" && sourceDomain.kind === "Unknown";
    const isNarrowingCast =
      castValue.kind !== "Primitive" &&
      !isLiteralDomain(sourceDomain) &&
      isLiteralDomain(targetDomain);
    return isUntypedCast || isNarrowingCast ? createUnknown("cast", typeCast.value.loc) : castValue;
  }

  #isCheckable(value: SymbolicValue): boolean {
    if (hasUnknownPart(value)) return false;
    let isCheckable = true;
    forEachSymbolicValue(value, (part) => {
      if (part.kind !== "Binding") return;
      if (part.binding.kind === "ref") isCheckable = false;
      const domain =
        this.#interpreter.bindingTable.placeDomains.get(getValuePlace(part)) ??
        (part.path.length === 0 ? part.binding.domain : undefined);
      if (domain?.kind !== "Cases") isCheckable = false;
    });
    return isCheckable;
  }

  record(claim: Omit<Claim, "file" | "isInHandler">): void {
    if (this.#isCheckable(claim.subject))
      this.#claims.push({
        ...claim,
        file: this.#interpreter.resolver.fileName,
        isInHandler: this.#interpreter.handlerEffects !== null,
      });
  }

  recordInvariant(
    name: string | null,
    argumentValues: SymbolicValue[],
    loc: SourceLocation,
    walkState: WalkState,
  ): void {
    const [test] = argumentValues;
    if (name === null || !CLAIM_FUNCTIONS.has(name) || test === undefined) return;
    this.record({
      kind: "invariant",
      subject: test,
      cases: null,
      test,
      guards: walkState.guards,
      description: `${name}(${describeCondition(test)})`,
      loc,
    });
  }
}
