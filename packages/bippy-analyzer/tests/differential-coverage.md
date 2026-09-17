# Differential coverage ledger

This ledger describes the native differential lane, not all analyzer tests. No finite corpus covers every JavaScript program. A passing defect guard records an unresolved discrepancy, not supported behavior.

## Determinism contract

- Generated campaigns use the fixed seed inventory and local `createSeededRandom` instances. Golden sequence and generator-interleaving tests detect accidental drift or shared random state.
- Finite boundary matrices enumerate their declared Cartesian products. JSON text categories, regexp patterns, and typed-array constructors cycle explicitly so category coverage does not depend on random selection.
- Programs use bounded data and loops. Regexp histories use a fixed number of calls, including zero-width matches; they never loop until a match fails.
- Native references execute in fresh strict Node VM contexts. Concrete outputs use `Object.is`; string snapshots preserve types or observable effect order.
- Symbolic references enumerate all four boolean assignments. Supported outputs must enumerate completely and survive exhaustive pinned replay without sampling or correction.
- Microtask tests use explicit queue checkpoints, not sleeps. These campaigns do not use wall-clock readings, unseeded randomness, network responses, default locale formatting, or machine-dependent byte order as expected values.
- DataView campaigns always specify byte order. Exact byte snapshots exclude NaN writes; separate NaN checks assert numeric round trips without assuming a byte payload.
- Date campaigns construct explicit timestamps, use UTC calendar methods and ISO output, and run under both `TZ=UTC` and `TZ=Pacific/Auckland`; they never read the current clock.
- Reproduce with the same Node/runtime and lockfile. Native error wording, Unicode data, and supported language features may differ across runtime versions; most exception witnesses compare error names and effects rather than engine wording.
- In the local Node v24.21.0 oracle, Object.fromEntries performs iterator return lookup/call after the tested next/done/value failures; the other six native consumers in that matrix do not. This is a recorded consumer/runtime distinction, not a cross-engine assertion.
- The local Node v24.21.0 oracle reports empty sealed/nonextensible arrays as frozen despite writable, changeable length. Frozen-metadata guards use nonempty dense arrays instead; this inconsistency is not recorded as an analyzer defect.
- Normal and fixed-seed shuffled full-suite runs must agree on the multiset of test names and statuses. Timing fields are deliberately excluded. Passing both orders is evidence against order dependence, not a proof over every possible order.

## Coverage and remaining axes

| Family                        | Current differential coverage                                                                                                 | Remaining axes                                                                                                           |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Bindings and completion       | Lexical/loop scopes, labeled finalizers, hoisting/immutable writes, 100 catch programs and switch/catch environment witnesses | Further declaration destructuring and abrupt initialization/finalizer combinations                                       |
| Expression completion         | 39 contexts × ten operand modes, six nullish controls, 80 literal-prefix cases, 14 symbolic effect programs and 56 pins       | Throwing conversion/iterator protocols, suspension, and nested finalizer combinations                                    |
| Primitive operators           | Primitive/equality/coercion products, boxed conversions, 88 binary abrupt-completion cases and logical reductions             | Further boxed conversion hooks and mixed compound references                                                             |
| Numeric formatting            | 540 Number cases, 245 BigInt radix cases, 96 completion cases, 78 borrowed-method receiver cases and exact crash guards       | Further borrowed/intrinsic methods, negative BigInt construction, conversion hooks and exponential formatting            |
| Strings                       | 567 UTF-16 and index-boundary programs, normalization/casing controls, padding witnesses                                      | Well-formedness APIs and further conversion hooks                                                                        |
| Regexp                        | Cursor histories, replacement/token matrices, 150 named-capture positional controls and exact marshalling crash guards        | Further custom exec/flags, Symbol match/search/split protocols and callback group mutation combinations                  |
| JSON                          | 300 round trips, 530 grammar/whitespace cases, symbolic fields, replacer/reviver/holder/spacing witnesses                     | Cycles, boxed replacer-list entries, newer reviver context arguments, additional toJSON interactions                     |
| Ordinary arrays               | Searches, mutation histories, resizing, copies, shallow element aliases, flattening, sorting, symbolic isolation              | Species, descriptor-constrained resizing, sparse/inherited elements, more generic array-like receivers                   |
| Typed arrays                  | Nine constructors on representable values, slice copies, bounded writes, conversion/view witnesses                            | Additional constructors, buffer slicing/resizing and transfer                                                            |
| DataView                      | 200 explicit-endian histories, 2,400 set/read pairs, 192-case range matrix, offsets and shared-state witnesses                | Buffer transfer/resizing, further BigInt cases and conversion-hook ordering                                              |
| Collections                   | Map/Set/weak collections, iteration, identities, 10,000 journal transitions                                                   | More callback/key combinations and collection subclasses                                                                 |
| Object properties             | Descriptor/Reflect matrices, integrity transitions, 338 frozen redefinitions, 100 accessor histories and state isolation      | Further partial-field values/flags, mixed Reflect/proxy protocols, integrity metadata transitions and prototype mutation |
| Bulk definitions              | 70 conversion/partial-commit cases, 33 symbolic descriptor selections and 132 concrete pins                                   | Mixed accessor/data transitions, inherited/proxy descriptor reads, target-side traps                                     |
| Descriptor fields/callbacks   | 148 field-layout/validation/lookup cases, 21 symbolic callable-selection cases and 84 concrete pins                           | Virtual descriptor fields, mixed inherited shadowing, descriptor and target invariant interactions                       |
| Proxy definitions             | 116 descriptor conversion cases, 112 target commit histories and 36 trap-result reductions                                    | Virtual/mutating descriptor presence, proxy descriptor maps, nonextensible/nonconfigurable target invariants             |
| Entry construction/key order  | 100 order-normalized programs, 70 entry conversion/close cases, 30 symbolic shape cases/120 pins, 534 own-key-order programs  | Further entry/iterator validation, larger symbolic shapes, inherited/non-enumerable ordering interactions                |
| Classes                       | Construction/static/private/super/heritage matrices, 100 prototype-chain programs and explicit-instance witnesses             | Further prototype-chain observations, private accessor combinations, home-object/prototype interaction matrices          |
| Function objects              | Bound invocation campaigns, 200 strict arguments programs, 105-case bound metadata matrix, initialization/identity witnesses  | Sloppy/mapped arguments in a separate non-strict oracle, further metadata getters and constructor/newTarget combinations |
| Iterators/generators          | Consumption/closing/delegation, 90 catch-binding/close cases, 112 protocol-consumer cases and explicit staged controls        | Further delegated getter failures, mixed async-generator yield-star and cancellation races                               |
| Promises/async                | Resolution/races/awaits, constructor/species/resolve protocols, 36 capability-constructor cases and six invalid receivers     | Further capability executor initialization states, async-generator delegation/cancellation combinations                  |
| Symbolic analysis             | States/replay, Boolean/provenance matrices, truth-table/association/input/factor-order products and 2,592 predicate pins      | Further Boolean normal forms, larger finite domains, mutable native metadata and cross-family composition                |
| Date/Intl/host APIs           | 200 explicit UTC calendar/copy/mutation programs, clipping and ISO controls, early-return branch witness                      | Pinned clocks, explicit Intl locale/options, further host-object state and native-call completion                        |
| Modules/framework integration | Separate existing module and fixture suites                                                                                   | Dedicated native multi-module/live-binding comparisons; maintain separate integration validation                         |

## Recorded limitations are part of coverage

See [differential-findings.md](./differential-findings.md) for exact witnesses and implementation research. Unsupported interactions are minimized into individual guards; supported seeded campaigns are not marked as broadly expected-failing.

Next priorities are further Boolean normal forms, larger correlated entry shapes, proxy descriptor maps/invariants, and async delegation/cancellation combinations. Async-generator witnesses currently characterize an unsupported evaluator path, not supported execution. Expand one bounded matrix at a time, retain adjacent passing controls, and rerun both deterministic test orders before claiming a new validated baseline.

## Reproduction

```sh
pnpm test --project bippy-analyzer differential --reporter=json --outputFile=/tmp/bippy-differential-report.json
pnpm test --project bippy-analyzer differential --sequence.shuffle --sequence.seed=424242 --reporter=json --outputFile=/tmp/bippy-differential-shuffled-report.json
TZ=UTC pnpm test --project bippy-analyzer packages/bippy-analyzer/tests/utc-date-differential.test.ts
TZ=Pacific/Auckland pnpm test --project bippy-analyzer packages/bippy-analyzer/tests/utc-date-differential.test.ts
pnpm --filter bippy-analyzer typecheck
```
