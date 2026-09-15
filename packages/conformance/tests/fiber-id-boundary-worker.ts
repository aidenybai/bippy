import { getFiberById, getFiberId, setFiberId, type Fiber } from "../../bippy/src/index.js";
import { createFiber } from "./fiber-fixture.js";

interface AllocationAttempt {
  identifier?: number;
  error?: string;
}

const boundaries = new Map([
  ["near", Number.MAX_SAFE_INTEGER - 1],
  ["at", Number.MAX_SAFE_INTEGER],
  ["beyond", Number.MAX_SAFE_INTEGER + 1],
  ["infinity", Infinity],
  ["nan", NaN],
  ["negative", -1],
]);
const boundary = process.argv[2];
const explicitIdentifier = boundaries.get(boundary);
if (explicitIdentifier === undefined) throw new Error(`Unknown boundary: ${boundary}`);
const witness = createFiber();
const originalWitnessIdentifier = getFiberId(witness);
const explicit = createFiber();
setFiberId(explicit, explicitIdentifier);
const fibers = [createFiber(), createFiber(), witness];
const allocate = (fiber: Fiber, index: number): AllocationAttempt => {
  try {
    if (index > 0) setFiberId(fiber);
    return { identifier: getFiberId(fiber) };
  } catch (error) {
    return { error: error instanceof Error ? `${error.name}:${error.message}` : "unexpected" };
  }
};
const attempts = fibers.map(allocate);
const witnessIdentifier = getFiberId(witness);
const result = {
  attempts,
  witnessIdentifier,
  originalWitnessReleased: getFiberById(originalWitnessIdentifier) === null,
  witnessLookup: getFiberById(witnessIdentifier) === witness,
  explicitIdentifierMatches: Object.is(getFiberId(explicit), explicitIdentifier),
  explicitLookup: getFiberById(explicitIdentifier) === explicit,
  allocationLookups: attempts
    .slice(0, 2)
    .map((attempt, index) =>
      attempt.identifier === undefined ? null : getFiberById(attempt.identifier) === fibers[index],
    ),
};
const alternate = createFiber({ alternate: explicit });
explicit.alternate = alternate;
console.log(
  JSON.stringify({
    ...result,
    inheritedIdentifierMatches: Object.is(getFiberId(alternate), explicitIdentifier),
    inheritedLookup: getFiberById(explicitIdentifier) === alternate,
  }),
);
