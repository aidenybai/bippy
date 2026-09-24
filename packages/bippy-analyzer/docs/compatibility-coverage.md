# Compatibility coverage

Passing tests, executed source lines, and supported JavaScript behavior are different claims.
This package measures them separately. It is not fully compatible, and the strict gate is
expected to remain red while documented defects and uncovered code exist.

## Commands

```sh
pnpm --filter bippy-analyzer test:coverage
pnpm --filter bippy-analyzer compatibility:report
pnpm --filter bippy-analyzer compatibility:check
```

`test:coverage` runs the analyzer tests with V8 coverage. The include pattern is anchored to
all TypeScript source under `packages/bippy-analyzer/src/`, including unimported files. Test
fixtures, dependencies, and development scripts are not counted as production coverage.
V8 avoids injecting coverage variables into callbacks that Playwright serializes into a browser.
Browser execution itself is not automatically included in Node's coverage counters.

Reports are written to the ignored `packages/bippy-analyzer/coverage/` directory:

- `test-results.json`: assertion-level results, including failures.
- `coverage-summary.json`: statement, branch, function, and line totals for every included file.
- `coverage-final.json`: detailed execution counters.
- `compatibility-summary.json`: gate result, uncovered files, missing test files, and explicit defect assertions.

`compatibility:check` runs fresh tests and coverage, then fails unless:

- The test run and every reported suite passed.
- Every discovered test file appears in the report.
- No assertions failed or were left unexecuted.
- No assertions are labeled as known divergences, precision gaps, crashes, limitations, unsupported behavior, or defects.
- Every discovered source file appears in the coverage report.
- Every source file and the aggregate have 100% statements, branches, functions, and lines, with no skipped coverage.

`test:coverage:strict` separately enforces Vitest's 100% per-file execution thresholds.
`compatibility:report --strict` checks the last saved reports without rerunning tests; regenerate
reports after changes. The report timestamp identifies the measured run.

Explicit defect classification uses test names, not semantic analysis of assertion bodies.
Keep the `known divergence:` / `known precision gap:` conventions, including for `it.fails`
tests. An unlabeled negative assertion can escape this classification. Even a green gate would
not prove exhaustive JavaScript or React compatibility.

## Evidence requirements

For evaluator changes:

1. Preserve a native reference and an exact regression that fails before the fix.
2. Check concrete inputs independently, not only model-derived pinned decisions.
3. Require native/model agreement before accepting symbolic-state and replay success.
4. Keep unresolved states, omissions, timeouts, and crashes visible. Do not increase budgets,
   delete witnesses, normalize incorrect results, or convert failures to skipped tests to pass.
5. Promote a known-defect assertion to a positive native comparison only after the fix is verified.
6. Run the surrounding regression families and the full package suite.

A successful pinned replay only confirms consistency with the constructed model. It can miss
native paths that the model omitted and can reproduce the same wrong result. The four-case
OpenCode audit demonstrated this for generator cursors, Date mutation, array-copy aliasing,
and descriptor selection. All four original witnesses now pass native comparison and replay.
Their historical failing evidence is retained; those fixes do not establish complete support
for generators, dates, arrays, or descriptors.

## Measured baseline

The normal-order full run starting `2026-09-20T21:39:29.460Z` passed all 340 test files: 15,419 passing
assertions and four expected failures, with no unexpected failures or unrun assertions.
The report separates 13,322 ordinary passes from 2,101 explicitly labeled defect assertions.
Those are assertion counts, not distinct root causes.

All 262 source files were reported; 225 remain below complete coverage. Statements: **84.01%**;
branches: **74.37%**; functions: **85.89%**; lines: **86.76%**. The strict report correctly exited
with status 1. The earlier per-file threshold smoke also exited 1. No exclusions or budget
increases were used to make these checks pass.

The full shuffled run (`--sequence.shuffle --sequence.seed=424242`) also passed all 340 files,
with the same assertion-name/status multiset and actual exit status 0. The earlier nine
`vite-resolved-environment.test.ts` shuffled failures remain in the evidence history. An isolated
React module loader now selects coherent development React/React DOM builds without changing
application environment values or the native module cache. Subprocess regressions cover both
production/development preload orders, effects, repeated commits, cleanup, and native identities.

The first concurrent bind-phase coverage run timed out in `compiled-tslib-async.js`; 439 later
fixture assertions were unresolved. Its actual exit 1 and reports are archived. Four focused
controls and an unchanged full rerun passed without increasing timeouts or changing assertions.
This records the failure, not a timeout fix. That bind-phase checkpoint followed the later bound-target fix.

## Current focused progress

- Numeric typed-array set now normalizes primitive offsets before source acquisition, validates
  source length before indexed reads, and converts/writes elements in order. Conversion or getter
  failure retains earlier writes and stops later reads. Typed sources snapshot; array-like reads are
  live and ignore iterators. Final 288 programs pass 1,152 assignments and replay, with 21 units and
  1,785 surrounding assertions. Three unchanged defects are native-positive: element conversion,
  oversized-source rejection and negative offsets. The 1,000-element array-like limit and sixteen
  optional-shape limit remain; element completion forks use the existing raw sixteen-combination
  bound while numeric alternatives stay compact. Nine 10,000-element helper controls and two late
  errors supplement, not replace, eight existing full-interpreter controls. Opaque invalidation now
  retains optional/repeat shape. Object coercion, ArrayBuffer source properties, generic receivers,
  detached/resizable buffers and shared storage remain incomplete. New test-domain and fixture
  mistakes, the initial abrupt-continuation error, and their original failures remain archived.

- Numeric typed-array indexed writes now convert primitive values before checking index validity,
  journal successful in-bounds writes and ignore invalid canonical indices without extending storage.
  Assignment/update results retain their pre-storage values. The initial matrix had 396 failures and
  36 passes; 225 final programs pass 900 assignments and replay. Noncanonical expando controls exposed
  two adjacent gaps: explicit String(Symbol) conversion and lost property-value guards in list journals.
  Known symbols now stringify descriptively without calling prototype hooks; primitive description and
  registry-key choices retain branches. Thirty-two programs check 128 assignments, including symbol
  identity. Named list-property joins now carry their existing fork predicate. Six units check error
  opacity, same-target receivers, conservative refusals, frozen-empty conversion and property guards.
  Final surrounding group: 753 passes. Four unchanged defects are native-positive: integer/clamped
  writes, out-of-bounds growth and explicit Symbol stringification. Object coercion, unknown keys,
  foreign receivers/proxies, length/descriptor writes, set and shared buffers remain incomplete.

- Numeric typed-array and ArrayBuffer primitive lengths now follow ToIndex conversion: strings,
  Booleans, nullish values, NaN and fractional lengths normalize before allocation checks. Negative
  integers, infinities and unsafe indices raise RangeErrors; BigInt/Symbol lengths raise TypeErrors.
  Only guaranteed-invalid primitive lengths reach native construction to capture Node/V8 error wording;
  valid lengths never delegate allocation. The existing 65,536-element analysis limit is unchanged.
  All initial 318 assertions failed. The final 159-program matrix passes 636 assignments and replay,
  including omitted lengths, ignored typed-constructor arguments and reflective getter throws.
  Fourteen units check allocation bounds, absence of native allocation for valid lengths, opaque stacks
  and choice metadata. A TypeScript error from passing a general error.name string was corrected by
  narrowing the constructor name, without a cast. Final surrounding group: 1,164 passes. No old defects
  were promoted. Object lengths, ArrayBuffer options, view spans/sharing, writes/set and generic
  construction remain incomplete.

- Numeric typed-array constructors and `.of` now propagate BigInt/Symbol conversion errors in element
  order. A definite failure stops before later unsupported object conversion; unsupported earlier
  conversion stays unknown rather than inventing a later error. Numeric branches remain stored as
  elements instead of expanding combinations. Error alternatives use the existing bounded distributor.
  All initial 360 assertions failed before implementation; 216 final programs pass 864 assignments
  and symbolic replay across constructors, of/apply and Reflect.construct. Direct argument evaluation,
  ignored constructor arguments and argument-list getter throws retain precedence over conversion.
  Nine units cover sixteen versus seventeen error alternatives, raw 4×4 acceptance/5×4 refusal,
  unexpanded numeric choices, provenance, opacity and two 10,000-element late-error controls.
  A missing scalar-dispatch fallback caused 217 intermediate failures and was corrected without
  changing comparisons. Final surrounding group: 1,117 passes. No old defects were promoted. Object
  coercion, generic receivers, generator gaps, indexed writes/set and shared buffers remain incomplete.

- Typed-array `.from` converts each mapped primitive before the next callback or array-like read.
  BigInt/Symbol conversion throws modeled TypeErrors with opaque stacks. Finite iterable mapping keeps
  its snapshot, ordered abrupt prefixes and sixteen-shape bound; definite prefixes grow iteratively.
  The initial 108-program matrix had 205 failures and eleven passes. Final matrices cover 144 programs
  and 576 assignments: all concrete comparisons pass, while nine unchanged symbolic generator-drain
  witnesses remain exact labeled gaps. The eager generator model discards conditional throws.
  Seventeen units cover conversion, errors/provenance, 10,000 elements, shape limits and scope journals.
  Full runs exposed one genuine closure-counter regression: alternatives saved caller bindings but
  omitted the mapper's separate closure. Forks now optionally snapshot both chains, deduplicating shared
  scopes and preserving the existing root exclusion. Disabling that capture reproduces 27 symbolic
  failures. Final surrounding group: 1,049 passes, including nine gap assertions. No old defect
  assertions were promoted. Object coercion, generic receivers, generator suspension/drain semantics,
  other callback closures, writes/set and shared buffers remain incomplete.

- Numeric typed-array `.of` now shares primitive element conversion with construction. Eighty-one
  programs check 324 assignments and replay across direct, spread, same-intrinsic-receiver call/apply,
  bind and Reflect.apply forms, including argument completion and source-copy isolation. Initial tests
  had 129 failures and 33 passes. Conversion exposed nine remaining symbolic brand failures: completion
  refinement cloned nonthrowing lists, losing binary brands and aliases. It now preserves nonthrowing
  values. Thirty-six further programs check 144 assignments across constructor/from/of results and
  alias writes; all 36 symbolic assertions failed with identity preservation disabled and now pass.
  Thirteen units cover identity, nine 10,000-element conversions and opaque-input refusal. The final
  surrounding group passes 638 assertions. No old defect assertions were promoted. Generic method
  receivers, object coercion, writes/set and buffer sharing remain incomplete. BigInt/Symbol of errors
  and primitive from conversion are covered by the subsequent work above.

- Nine numeric typed-array constructors now convert finite primitive-valued lists rather than copying
  raw values. Fixed-size native scratch storage supplies wrapping, clamping and floating-point rounding;
  conversion never invokes program object hooks. Source/element choices and finite optional shapes retain
  guards, preferences and brands. Ninety programs check 360 assignments and replay. Initial tests had
  154 failures and 26 passes; the final surrounding group passes 551 assertions. Thirteen units cover
  10,000-element conversion for each constructor, the unchanged sixteen-shape bound, choice metadata
  and opaque-input refusal. Five unchanged defect assertions became native-positive, including the
  Uint8Array overflow control discovered during constructor eligibility work. Object element conversion,
  object length coercion, custom iterators, writes, set and shared buffers remain incomplete.
  Primitive of/from conversion is covered by the
  subsequent work above.

- New-expression dispatch now rejects known nonconstructors before builtin execution or proxy
  construct-trap lookup, but after argument evaluation. Primitives, namespaces, intrinsic methods,
  nonconstructor proxies and selected targets have controls; valid constructors and proxy overrides
  still run. Seventy-four programs pass 296 assignments and replay; three units keep error messages
  and stacks opaque. Initial tests had 127 failures and four passes; the final surrounding group passes
  561 assertions. That checkpoint recorded four exact defect assertions: eager global accessor
  definition and missing Uint8Array element conversion. The latter also failed with the eligibility
  guard disabled and is now fixed by the subsequent primitive conversion work above. Original bodies,
  native expectations and historical failures are retained. No old defects were promoted in the
  eligibility phase. Opaque/lifted callable capabilities, global descriptors, broader typed conversion
  and proxy semantics remain incomplete.

- Direct and reflective construction of the Symbol/BigInt intrinsics now throws modeled TypeErrors
  without coercing arguments. Argument expressions and array-like acquisition still complete first;
  invalid newTarget validation and getter throws retain precedence. These unconditional body failures
  also resolve with a foreign newTarget, without reading its prototype. Thirty-nine programs pass
  156 assignments and replay; three units preserve opaque stacks and leave other intrinsic bodies
  alone. Initial 66 assertions had 46 failures and twenty passes; final surrounding 398 assertions pass.
  Error branding, intrinsic renaming and shadowed local constructors have controls. No defects were
  added or promoted. Bound intrinsic wrappers, general foreign-newTarget allocation, native-constructor
  eligibility and other construction bodies remain incomplete.

- Reflect.construct now validates supported target/newTarget constructor capabilities before acquiring
  array-like arguments. Length is read once, indices remain live and ordered, iterator methods are not
  acquired, and getter throws prevent invocation. Seventy programs pass 280 assignments and replay;
  one unchanged function-source error-message witness remains two exact precision gaps. Initial 128
  assertions failed; final surrounding 337 assertions pass. Twelve units cover constructor slots,
  trap-free native classification, revoked proxies, uncertainty, existing distribution/array-like bounds
  and independent 10,000-item definite storage. Native probes corrected two mistaken assumptions:
  Node/V8's missing-argument behavior and the constructor slots of Symbol/BigInt, distinct from whether
  their constructor bodies succeed. These observations are pinned to Node 24.21.0, not engine-neutral
  promises. No old defects were promoted. Foreign new.target, opaque/lifted callable capabilities,
  general length coercion, broader list descriptors and function-source error messages remain incomplete.

- Bound ordinary-function construction now uses the original target and accumulated arguments,
  ignoring bound receivers and wrapper prototypes. Target prototypes remain live; primitive prototypes
  use Object.prototype. Constructor returns and throws retain their effects. Known interpreted
  non-constructors throw modeled TypeErrors with opaque messages/stacks. Default bound instanceof
  follows the target; guarded prototype selection keeps the existing sixteen-pair raw bound. Definite
  Reflect.construct argument lists retain value branches and copy storage before invocation.
  Sixty-nine programs pass 276 assignments and replay. Two unchanged ambient-input reread programs
  pass concrete checks but remain exact symbolic precision gaps; they increase the defect count rather
  than hide extra modeled states. Five units cover distribution bounds/correlation and error opacity.
  Initial 118 assertions failed; the surrounding final group passes 366. Bound classes, foreign
  new.target, custom hasInstance, broader prototype kinds, broader Reflect.construct support
  and exact non-constructor error messages remain incomplete.

- Interpreted functions now store own length/name metadata in journaled property entries. Deletion,
  presence checks and binding retain aliases and fork-local state; definite reflection respects absence
  and reinsertion order. Binding checks own length presence before reading it. Thirty-five programs
  check 140 concrete assignments and replay; four units include an independent native inherited-getter
  control. Initial tests had 56 failures and eight passes. Both first full runs caught a recursion-guard
  regression: fresh method metadata needed scalar value comparison. Existing-callee property rewrites
  remain progress signals, with five programs / twenty assignments guarding counter, signed-zero,
  NaN, object and symbol changes. An overly broad comparison and a symbolic numeric/text harness
  mismatch are preserved in the evidence history. Final surrounding 517 assertions pass; no existing
  defects were promoted. Class/lifted callable metadata, arbitrary prototype changes, descriptor
  enforcement, guarded key enumeration and broader reflection remain incomplete.

- Interpreted-function binding now reads current length/name metadata in order, preserving getter
  effects and throws without coercing non-number lengths or non-string names. Rebinding snapshots
  metadata and retains the original receiver, arguments and callable target. Distinct bindings have
  allocation identities preserved through component references. Sixty-nine programs check 276 concrete
  assignments, symbolic enumeration and replay; one unit checks cloned/component identities. Initial
  104 assertions failed, supplemental identity controls failed eight assertions, and four later
  invocation controls failed eight more despite an intermediate green full run. Named-function bodies
  now read the original target's live properties, not the wrapper's metadata. Two unchanged defect
  witnesses are native-positive. Remaining callable kinds, arbitrary inherited metadata, descriptor
  flags, class/proxy binding, broader construction and prototype changes remain incomplete.

- Interpreted functions now store own accessors without invoking getters during definition.
  Reads/writes bind the function receiver, preserve abrupt results, and support valid accessor/data
  replacement. Own accessor descriptor reads preserve getter/setter identity without invoking them.
  There are 120 positive programs / 480 concrete assignments. Four unchanged Object.create(function)
  probes remain eight explicit precision-gap assertions, raising the defect count rather than hiding
  unsupported prototypes. Equivalent join decisions now merge differing input metadata; two units
  preserve input provenance, preference and the unchanged sixteen-combination raw limit. Class/list
  accessors, function values as prototypes, general descriptor flags and exact getter-only function
  error messages remain open.

- Arrays, binary lists and interpreted functions/classes now honor string-valued data tags and
  non-string overrides. Async/generator function tags have matching property reads and presence.
  Eighty-nine programs check 356 concrete assignments, including live definition/deletion and
  inherited class data tags. Named list deletion now removes properties and non-enumerability metadata;
  twelve programs check 48 assignments. Another twelve programs check string-key enumeration,
  excluding symbols and ArrayBuffer bytes across keys/values/entries/for-in. Definite enumeration
  retains the original receiver's binary brand. Two unchanged deletion witnesses are native-positive;
  sealed-array deletion remains a labeled defect with its changed exact diagnostic. Array/class
  accessors, sparse/indexed deletion, integrity flags, reflection and prototype mutation remain open.

- Ordinary-object `Symbol.toStringTag` getters now run once with the actual receiver, preserving
  effects, branches and throws through direct/call/apply/bound calls and numeric conversion.
  Eighty-four effect programs check 336 assignments; fifteen own-tag programs check 60 assignments,
  alongside 54 native default-brand controls and three uncertainty units. Bound calls keep
  Object.prototype.toString behavior instead of dispatching a receiver's unrelated toString method.
  Primitive non-string tags use the builtin default; tag objects are not coerced. Accessor tags on
  remaining receiver kinds, proxies and broader prototype mutation remain incomplete.

- Numeric unary operators now share ordered ordinary-object conversion with updates, including
  mixed primitive/object alternatives and abrupt hooks. A 180-program matrix checks 720 concrete
  assignments and replay, with controls proving `!`, `typeof` and `void` do not coerce objects.
  Numeric conversion accepts eight raw method choices and refuses nine for each unary operator.
  All 180 initially failing assertions now pass; no existing defect labels were removed in this phase.

- Ordinary-object updates now evaluate numeric conversion hooks in order, preserve receivers,
  distinguish primitive results from objects/functions, and stop before writes on errors.
  There are 116 native-positive programs (464 concrete assignments) plus two raw-bound units;
  six unchanged old witnesses are native-positive. Eight supplemental programs exposed ignored
  `Object.setPrototypeOf` mutations: their unchanged bodies remain sixteen exact labeled defects.
  This discovery raises the defect count despite the six fixes. `Object.create` inherited/null
  prototype controls pass. General coercion, prototype mutation, and accessor tags on nonordinary receivers remain open.

- Symbol increment/decrement now throws before writing or invoking setters, while retaining
  key/getter effects and guarded numeric paths. Forty-eight programs check 192 concrete assignments
  and replay across locals, array indices, own/inherited accessors, string/symbol keys and prefix/postfix
  forms. Two unchanged update witnesses are native-positive; general object-to-numeric conversion remains open.

- Primitive unary minus/bitwise-not use numeric conversion; numeric unary operators throw on
  symbols. Sixty-six programs check 264 concrete assignments and replay. Guarded `Object.is`
  preserves SameValue results and provenance for signed zero, NaN, symbols and reference identity:
  twenty more programs check 80 assignments, with three raw-bound/predicate/preference units.
  General object coercion remains incomplete. No old defect assertions were promoted in this phase.

- Mixed BigInt numeric operations, zero divisors, negative exponents and unsigned shifts now throw
  before later effects or compound-assignment setters. A 120-program matrix checks 480 concrete
  assignments and replay, including string-concatenation controls. Seventeen unchanged defects
  are native-positive. Three error-branding controls and six units preserve opaque host stacks,
  arithmetic-versus-relational boundaries, and refusal of unsupported positive powers/shifts.
  Only known failing native BigInt operations run; general successful BigInt arithmetic remains unsupported.

- Ordinary-object accessors with explicit undefined getters/setters now behave as absent functions,
  including guarded journal joins. Reads return undefined; strict writes without setters throw;
  callable accessors still execute when they return or throw undefined. Twenty programs check 80
  concrete assignments and replay across own/inherited and string/symbol properties. Two unchanged
  clearing-accessor witnesses are native-positive. Descriptor conversion, metadata preservation
  and function/list accessor storage remain unresolved.

- BigInt-to-BigInt comparisons are exact; unary minus/not retain BigInt values, while unary plus
  throws the native TypeError. Forty-two programs check 168 concrete assignments and replay,
  including signed, safe-integer-boundary and 128/256-bit operands. Eight unchanged original
  witnesses are native-positive. Mixed-type comparison and other BigInt arithmetic remain gaps;
  no exponentiation/shift resource limit or evaluation budget was increased.

- List `in` checks now retain explicit named properties, use Array/typed/ArrayBuffer prototype
  brands and distinguish canonical numeric indices. Selected keys use existing bounded binary
  distribution; selected receiver presence retains guards/preferences. Seventy-three programs
  check 292 concrete assignments and replay. Sparse holes and conditional expando presence remain
  unresolved. Native global controls explicitly establish missing keys rather than assume an
  unconfigured ambient global is absent.
- Known Boolean scalars now stringify to guarded `"true"`/`"false"` alternatives. Twenty-four
  programs check 96 concrete assignments and replay; arbitrary unknown values remain unknown.
  The raw 16-pair limit is retained. Twelve still-wrong diagnostic strings changed, but their
  labels, native references and bodies were retained; **none was promoted**. The clock fixture
  now exposes the native Boolean text alternatives instead of an unknown text node.

- Object literal keys, values and spread sources stop on abrupt completion. Eighteen programs
  check 72 concrete assignments and replay, including selected keys and accessor prefixes.
  All 42 original object-prefix/context guards are native-positive. Forks copy accessor-prefix
  records; the definite path remains iterative, and over-budget key choices stay opaque.
  Four new 10,000-element literal controls and the four existing Array/typed-from controls match
  native execution. Effectful spread getters and general key coercion remain separate gaps.

- Plain/tagged templates now stop after thrown substitutions or tag lookups. Fifteen programs
  check 60 concrete assignments and replay; 50 original defect assertions are native-positive.
  Repeated identical list-presence predicates now share one join decision rather than duplicate
  its Cartesian factor. The join limit remains 16 combinations: four independent choices are
  accepted, five refused. Raw finite-list expansion and branch/distribution budgets are unchanged.
  Template identity, raw/frozen objects, receivers and implicit coercion remain separate gaps.

- Array literals now reuse ordered argument evaluation, preserving their existing spread expansion
  and hole representation while stopping after thrown elements/spread sources. Eighteen programs
  check 72 concrete assignments and replay across ordinary/spread/nested/hole/consumer contexts.
  All 29 original prefix/context/source-throw defects are positive native comparisons. Linear
  definite evaluation and the four 10,000-element controls remain intact; sparse-property semantics
  and iterator-step/closing defects are not claimed fixed.

- Binary, logical, and conditional expressions propagate an abrupt left/test value before
  evaluating subsequent operands or arms. Successful scalar/branch evaluation keeps its prior
  path; only potentially thrown branches need the new continuation. Seventy-eight programs
  check 312 concrete assignments and pinned replay across 26 expression forms and three thrown
  payload kinds. All 56 original binary/logical/conditional defect assertions now agree with
  native unchanged. Coercion ordering and remaining literal/binding completion defects are separate.

- `toSorted()` now allocates independent backing storage even for empty and singleton arrays.
  Eight prior exact defect assertions became positive native comparisons.
- `join()` retains the predicates controlling optional list elements. Conditional truncation
  no longer permits impossible partial arrays in the new copy-isolation matrix. An existing
  conditional push/pop alias precision guard also became a positive native/replay assertion.
- `array-copy-isolation-matrix.test.ts` covers five copying operations (`Array.from`, `slice`,
  `concat`, `toReversed`, `toSorted`), lengths 0/1/2, both mutation targets, direct/aliased writes,
  append/overwrite/truncate, early returns, and an independent second conditional mutation:
  360 symbolic programs plus all 1,440 concrete Boolean input assignments. Symbolic checks also
  require complete pinned replay.
- `Array.from` with an omitted or undefined mapper copies finite list storage rather than
  returning its source. Both original argument-copy and array-identity defects are now positive
  comparisons. Eight additional programs check shallow payload aliases, selected sources,
  arguments, array-like objects, frozen inputs, and non-index properties across 32 concrete pins.
  Nested finite heap joins retain guarded optional elements instead of widening them to repeats;
  key enumeration handles those finite shapes. Shape expansion keeps the existing 16-alternative
  structural budget and has a 10,000-item definite-list unit control.
- `Array.from` and typed-array `from` reject the tested non-callable mapper forms before iterator
  lookup, pass two mapper arguments, preserve `thisArg`, and isolate finite source/mapper branch
  effects. A 66-program matrix checks 264 concrete assignments, including exact error messages,
  bound and arrow callbacks, and conditional closure/receiver writes. Eleven further controls
  check binary array brands and the unchanged third argument for ordinary array mapping.
  `Array.isArray` no longer mistakes modeled binary storage for an ordinary array. Live stepping,
  callback exception timing, general callable/coercion behavior, and iterator closing remain unresolved.
- Typed-array `from`/`of` now own their element storage; typed `from` snapshots resolved iterable
  values before mapping. A 90-program, nine-constructor matrix checks 360 concrete assignments,
  mutation timing, apply-argument aliases, and shallow payload identity. Twenty further programs
  check finite guarded `pop`/`shift` with 80 concrete assignments. Impossible branch alternatives
  are removed using the existing guard solver, without increasing construction/distribution limits.
  Four standalone 10,000-element native/model controls pass with omitted and native Math.abs
  mappers. Numeric conversion and shared-buffer behavior remain incomplete.
- Default-array `Array.of` construction now has eight programs and 32 concrete assignments
  covering spread/apply/Reflect.apply, independent calls, frozen inputs, and shallow aliases.
  `Reflect.apply` reaches its own implementation instead of being mistaken for a Function.apply
  call on the non-callable Reflect namespace. Eighteen programs check 72 concrete assignments
  across direct, aliased, call/apply/bind, and nested invocation, including receivers and throws.
  The original bound-callback-once witness is now a positive native comparison. Generic
  constructors and full invalid-target validation remain incomplete.
- Function `apply` treats omitted, undefined, and null argument lists as empty and forks finite
  argument-list choices before invoking the target. Twenty programs check 80 concrete assignments
  across interpreted functions, globals, bound native wrappers, and borrowed methods, including
  selected nullish/list arguments. Both original omitted/null defects are positive comparisons.
  Reflect.apply retains its distinct argument-list requirements.
- Apply argument acquisition now reads array-like length once, then indices in order, before
  invocation. Getter/throw branches retain journaled effects and stop later reads on thrown paths;
  iterator properties are ignored. Thirty-six programs check 144 concrete assignments, including
  inherited getter receivers, primitive length coercion, invalid lists, and argument copying.
  Six original invocation/copy/isolation defects are positive comparisons. The existing 1,000-item
  array-like bound remains; definite 10,000-item lists bypass it and retain independent storage.
  Dynamic/object length coercion and complete target validation remain unsupported. This is not
  live default-array iteration; the subsequent array-like consumer work is described below.
- Array/typed `from` now share fixed-length, live-index array-like mapping, stop reads after
  getter/mapper throws, acquire getter-provided iterator methods once, and reject the tested
  invalid iterator and primitive length forms. All twelve original native/model probes now agree.
  Twenty-four programs check 96 concrete assignments and replay; four additional assertions
  cover getter-only write errors on ordinary objects. The original Array.from iterator-getter
  throw defect is a positive comparison. An introduced finite-cursor draining regression was
  fixed before full verification; existing generator/Map/Set cursor controls remain intact.
  Default-array live cursors, incremental custom iterable mapping, and IteratorClose remain unresolved.
- Generator and Map/Set iterator positions are journaled across forks, including fresh cursors
  created inside a branch. Inspection no longer consumes a cursor. The shared-cursor matrix
  covers 86 programs and all 344 concrete input assignments, including fresh allocation,
  plus non-consuming inspection regressions.
- Explicit native Date timestamps are journaled. UTC setters, aliases, copies, invalid dates,
  recovery, coercion, exceptions, and correlated arguments have 48 symbolic programs and
  192 concrete input assignments. The multi-argument correlation cases capture their Boolean
  inputs in local bindings; repeated free-global reads remain a separate precision boundary.
- Binary distribution rejects guard-incompatible pairs, and structural expansion retains
  independent input predicates. Existing correlation-boundary, descriptor-snapshot, and
  fork-alias guards became positive comparisons without increasing the 16-pair budget.
- Finite computed object keys preserve source evaluation order and branch-local accessor
  prefixes. Descriptor calls distribute argument and descriptor choices while preserving payload
  aliases. All 14 descriptor-selection defect guards and three computed-key precision guards
  became positive checks. A separate 149-program matrix adds 596 concrete assignments across
  string/index/symbol keys, nine construction forms, four mutable payload kinds, and effect controls.
- Finite `Object.fromEntries` choices retain key, pair, presence, and container predicates.
  All 15 selection guards became positive checks, alongside the original empty-pair, symbol-key,
  and empty-string-input witnesses. A 35-program matrix checks 140 concrete assignments,
  selected cursors, aliases, duplicate keys, and special property names.
- Inherited property lookup follows own-property presence, not whether its value is undefined.
  Receiver identity and ordinary/null prototype provenance have 14 symbolic programs and
  56 concrete assignments. These checks do not establish complete prototype semantics.
- Primitive string iteration uses Unicode code points. Finite iterable choices retain guarded
  state through collection construction, destructuring rest, and for-of continuations.
  An 81-program matrix checks 324 concrete assignments, including empty strings, astral
  characters, lone surrogates, and loop break/continue/return. Live array iterators remain unsupported.
- Complementary guard clauses are factored without increasing the 64-atom budget. Truthy/falsy
  filtering and narrowed values retain their original predicates and logical truth provenance.
  All 648 programs across truth-table pairs, normal forms, association, factor order, and input
  order now pass symbolic enumeration/replay and 2,592 concrete assignments. Their 265 remaining
  defect guards became positive checks. A separate 36-program matrix checks logical truth and
  result types for primitive and object operands, including regular expressions.

These matrices do not establish all array semantics. `with`, `toSpliced`, sparse/species behavior,
ranged mutations, coercion, and larger correlated arrays need their own evidence. The existing
[differential coverage ledger](../tests/differential-coverage.md) maps additional language families;
[differential findings](../tests/differential-findings.md) record remaining witnesses. Historical
counts in those documents are not a substitute for a fresh machine report.

## OpenCode review

Use the [OpenCode runner](opencode-audits.md) with
[`scripts/prompts/compatibility-audit.md`](../scripts/prompts/compatibility-audit.md) for independent
coverage discovery and proposed regressions. Supply the local React clone path when delegating.
Workers write proposals in their run's artifact directory; the supervisor reviews,
applies, and executes them. Do not accept a worker's `succeeded` status as proof of compatibility.
The coverage worker identified a missing `known precision gap` classification in the report;
that category now has a gate regression test.
