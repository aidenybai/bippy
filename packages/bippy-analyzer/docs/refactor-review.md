# Engine refactor review

This checkpoint reviews the completion/symbolic, React, and runtime-foundation refactors against the saved pre-refactor worktree. Git HEAD was not the baseline: the worktree already contained user changes and differential tests.

## Verdicts

**Structure:** the refactor improves ownership and removes concrete dependency cycles. It does not make the whole engine a dependency DAG. `Interpreter` remains large, the value/predicate subsystem remains mutually recursive, and legacy type dependencies remain coupled.

**Behavior:** no refactor-induced regression was found in the checks below. This is not a claim that the analyzer implements all JavaScript or React semantics correctly. Existing compatibility gaps, uncertainty, and expected test failures remain.

## Findings addressed

1. The source-type wildcard export unintentionally exposed `TypeScriptDeclaration` from the package root. Root source-type exports are now explicit. Both supported entry points retain their original 199 exported names, with no additions or removals; relocated exported interface/type declarations match the baseline.
2. The initial cycle test examined only a selected subgraph. A cycle through an unlisted intermediate module could pass. Runtime cycle validation now traverses the entire analyzer source graph. Dependency-reader tests cover re-exports, mixed/type-only imports, import types, literal dynamic imports, literal requires, and package self-imports. Cycle-detector tests include indirect and overlapping cycles.
3. Prototype inspection imported class evaluation just to read ownership metadata. `prototype-owners.ts` now owns that weak registry. Registration remains before member binding; the class-body prototype cache and member-count cache retain their original ownership and lifetime.
4. Clock-date modeling imported coercion/prototype inspection just to construct numeric intervals. `number-ranges.ts` now owns interval construction and operations.
5. Native value conversion, host-global lookup, and event execution imported each other. `language-intrinsics.ts` now owns the isolated language realm and intrinsic mapping. Native member classification owns the shared listener-method names; event execution consumes them.
6. React API recognition recorded evaluator derivations, pulling it into the value/predicate cycle. External-member value construction now lives in evaluation; React API recognition has no evaluator dependency.

## Boundary review

| Area                          | Checks and retained behavior                                                                                                                                                                                                                              |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Symbolic foundations          | Guard operations, solver behavior, schemas, and serialization were relocated without changing their runtime bodies. Evaluation no longer imports the harness.                                                                                             |
| Completion and scope journals | Outcome joins, preferred paths, scope restoration, widening, and suspension records retain their implementations. No changes to predicate allocation or lifetime were bundled into extraction.                                                            |
| Operators and builtin methods | All 53 React API case bodies match the baseline after resolving hook delegation. Builtin dispatch matches after inlining array dispatch, including callback binding and fallback order. String and numeric operation bodies are unchanged.                |
| React hooks and children      | Hook cells, pending reducer actions, Strict Mode factory checks, memo reuse, subscriptions, effect registration, child keys, and Flight alternatives retain their behavior. Tests exercise these subsystems without an interpreter.                       |
| Element factory and context   | The public `Interpreter.createElement` signature remains, delegates to element construction, and is still honored by API dispatch. Tests cover factory overrides. Provider lookup consumes the existing provider-policy flag rather than the interpreter. |
| Runtime foundations           | Weak prototype ownership, language-realm identity, canonical globals, numeric ranges, and external-member construction have direct tests. Module-level caches were not made per-run or duplicated.                                                        |

## Evidence at this checkpoint

- An AST/emitted-body comparison matched **4,337 of 4,347 original runtime declarations**, including **224 relocations**, after removing type syntax/comments and normalizing the `evaluator` parameter rename. This comparison does not establish equivalence of module initialization order.
- The ten changed bodies are the builtin and React dispatchers, the public element factory, prototype registration, and six provider-policy consumers/helpers. Their extraction and call-site changes were inspected separately. Inlining the array extraction reproduces the original builtin dispatcher; resolving hook delegation reproduces every original React API case body.
- **1,301 pre-existing test and fixture bodies** are unchanged apart from imports and formatting. Existing assertions were not relaxed.
- **30 independently rendered before/after fixtures** produced byte-identical serialized captures, diagnostics, symbolic trees, state enumerations, and omissions after removing capture timestamps. The selection covers correlated guards, mutation, async causes, hooks, reducers, contexts, JSX keys, classes, prototypes, dates, and native introspection. These are model comparisons, not a new browser-corpus capture.
- Cyclic runtime import groups decreased from four to one; the largest decreased from 15 modules to two. The largest group including type-only edges decreased from 132 modules to 27. These are source dependency measurements, not performance measurements.
- Full repository suite: **391 files passed**, two skipped; **10,066 tests passed**, four expected failures, two skipped.
- Repository typecheck, build, realm-table verification, changed-file formatting, and `git diff --check` passed. Lint reported only the existing unused-parameter and unnecessary-spread warnings. The build command builds core Bippy and checks its React entry point; the analyzer is source-only and is checked through typechecking and tests.

The full-suite command was:

```sh
TMPDIR="$(cd "$TMPDIR" && pwd -P)" pnpm test --maxWorkers=4
```

Canonicalizing `TMPDIR` avoids macOS temporary-path aliases observed in the baseline. Four workers avoid the async fixture timeout seen under default parallelism; no test timeouts or assertions were increased.

React source was inspected in a local `facebook/react` checkout at `71f725593739d2cb5866a282a1075d581831722f`, including hook queues, external stores, child traversal, JSX cloning, and base-class prototypes.

## Final review

No additional blocking issue was found. No engine or test changes were made during this final pass.

- A fresh full-suite run with **default worker parallelism** passed: 391 files, 10,066 passing tests, four expected failures, and two skipped tests. The command was `TMPDIR="$(cd "$TMPDIR" && pwd -P)" pnpm test`. Earlier timeout failures remain evidence of timing sensitivity; this successful run is not a guarantee against future flakes.
- Public API checking was extended beyond export names and exported type declarations to callable signatures, constructors, and public class members. All 599 compared type/signature/member records match after normalizing module qualification and the three option-interface renames. The renamed option interfaces were separately checked to have identical members.
- Runtime declaration, dispatch reconstruction, and pre-existing test-body comparisons were rerun and retained their previous results.
- The thirty before/after model fixtures were rendered again in separate processes and compared afresh, not just rechecked from previously saved output. Their serialized results still match after removing capture timestamps.
- Repository typechecking passed again. The build, realm, lint, and formatting evidence above applies to the same engine source; only this review document was updated in the final pass.

**Final structure verdict:** acceptable for the scoped refactor, with the remaining coupling below explicitly acknowledged.

**Final behavior verdict:** no introduced regression found within the stated validation coverage. This is not exhaustive compatibility certification.

## Remaining limits

- `values.ts` and `predicates.ts` still call each other for branch construction and guarded truthiness. The whole-graph runtime test explicitly permits only that pair. Replacing this with a service locator or callback injection solely to hide the import cycle would not improve ownership.
- Type-only cycles remain, especially among the interpreter, host integration, and library models. The narrow extracted contracts do not establish clean boundaries throughout all legacy code.
- The dependency reader checks statically named dependencies, not imports whose specifiers are computed at runtime.
- Passing differential tests includes tests that preserve known divergences. Snapshot/model agreement and runtime fixture matching are bounded evidence, not exhaustive semantic proof.
- Browser corpus recapture, broad performance benchmarking, and semantic compatibility fixes were not part of this checkpoint.
