# Parity goal and current evidence

The goal is application and React parity, not a replacement JavaScript interpreter. Delegate parsing, execution, operators, coercions, built-ins, and exceptions to engine262 wherever possible. Reuse actual React and native toolchain behavior. Keep analyzer code focused on unknown values, guards, state ownership, host integration, and observations.

When engine262 cannot support a required behavior, prefer a reviewed engine fix or extension over a separate analyzer implementation. A passing test selection is evidence for that selection, not proof of full correctness.

## Current status

| Area                       | Evidence                                                                                       | Remaining gap                                                          |
| -------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Source-built engine        | Reproducible builds; original and extended engines both pass 301/306 selected Test262 variants | Five retained failures; not full Test262 conformance                   |
| Guarded scalar expressions | Independent values, exceptions, guard partitions, and syntax-node traces                       | Boolean input domains only; no general numeric/string constraints      |
| Application loading        | Native resolver/build work exists separately                                                   | Not integrated with execution here                                     |
| Concrete React             | Not implemented here                                                                           | Real React, host environment, mounts, updates, and effects             |
| Symbolic React             | Not implemented here                                                                           | Mutable state isolation, continuations, guarded trees, and transitions |

See the [implementation roadmap](../ROADMAP.md) for all stages. The scalar increment does not complete the React parity goal.

## Scalar parity gate

Run from the repository root with Node 26+:

```sh
pnpm --filter bippy-analyzer test --run
pnpm --filter bippy-analyzer typecheck
```

The current local suite passes **651 tests across four files**, using at most two workers. The dedicated `tests/scalar-parity.test.ts` selection includes:

- All 144 ordered pairs from 12 selected scalar literals for each of 23 binary/control operators. These produce 3,312 guarded expression templates and 13,248 Boolean witness runs per reference engine.
- 192 generated cases from three fixed seeds, containing 160 distinct expressions. Each uses three declared Boolean inputs and checks all eight assignments, for 1,536 additional witness runs per reference engine.
- Sixteen focused integer-boundary, shift, BigInt-error, and correlation cases.

The generated selection uses depth four and bounds exponent and shift operands during generation. This limits fixture cost without discarding failures. Its SHA-256 is `a29237ea49425e28851872523d257191b4e3d824118e712b3c76d8ccade01f7c`. The test fails if the selection changes or a generated source exceeds the API limit. No rejected or failing program is filtered out.

Other tests retain the earlier coercion matrix, unary operators, rejection boundaries, resource limits, serialization, realm isolation, source maps, and artifact checks.

For each concrete Boolean assignment, the oracle requires:

1. Exactly one matching outcome, with no undeclared guard inputs.
2. Every reported outcome and trace entry to have at least one concrete witness.
3. Values and exception names/messages to match the unmodified engine.
4. Values and exception names to match independent Node execution. Native error messages are not required to match engine262's wording.
5. The specialized syntax trace to match the unmodified engine's node types, text, source spans, and evaluation order.
6. A JSON round trip to preserve the report, including negative zero, infinities, `NaN`, and BigInts.

The reference engine executes each witness once. It observes error fields from the original completion rather than rerunning failing code. Its input bindings and parser are independent of the symbolic adapter. A separate test-side guard evaluator checks the serialized guard contract.

## Limits of this evidence

The literal matrix is exhaustive only over its selected literals and operators. Seeded syntax generation is not exhaustive over JavaScript. Syntax-node traces do not expose every internal specification operation, and value/error parity does not establish mutable heap or scheduler parity.

Calls, objects, property access, mutation, statements, loops, asynchronous work, and React remain outside this scalar contract. Budget exhaustion and unsupported syntax still fail rather than return partial success. The engine artifact and archived Test262 diagnostics are unchanged by these adapter tests.

## Acceptance for later stages

Before broadening a contract, identify the engine262 implementation to reuse and add an independent regression gate. Compare engine and host writes before admitting effectful coercion or calls. Compare actual React commits, state, effects, and scheduling against native execution before reporting React support.

Retain mismatches and original diagnostics. Record whether each result is exact for its declared domain, overapproximated, unsupported, or incomplete. Do not hide failures by replacing dependencies, changing input domains, excluding cases, or raising budgets.
