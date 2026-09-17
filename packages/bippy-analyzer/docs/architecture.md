---
meta:
  title: How the parser builds and checks React trees
  navLabel: Understand Parser Architecture
  contentType: Conceptual
  category: Architecture
  plan: ../../../scratchpad.md#architecture-documentation-plan
---

# How the parser builds and checks React trees

This document explains how `bippy-analyzer` builds a model of a React application and checks it against application captures. It describes the data structures and design decisions so you can understand and modify the implementation. It assumes you know TypeScript and React.

The implementation is incomplete. Some checks can find errors without proving that the model is correct. The sections below distinguish the intended guarantees from the checks that the code currently performs.

The document follows the main implementation areas:

- [Design constraints](#design-constraints)
- [Analysis phases](#analysis-phases)
- [Module resolution and run state](#module-resolution-and-run-state)
- [Conditional evaluation](#conditional-evaluation)
- [Rendering with React](#rendering-with-react)
- [Symbolic states](#symbolic-states)
- [Comparison and replay](#comparison-and-replay)
- [Implementation limits](#implementation-limits)

## Design constraints

The parser interprets application source but uses React to construct the resulting component trees. This division avoids executing application bodies without requiring a separate implementation of React reconciliation.

### Interpret application bodies

The interpreter computes possible values from source expressions. It does not import an application component and call the component function. The interpreter must preserve unresolved inputs instead of assigning arbitrary values from the analysis environment.

This restriction does not make analysis a security sandbox. React packages and analysis infrastructure execute outside the interpreter. Project build configuration and plugins can execute when the renderer loads them.

### Use React for reconciliation

Reconciliation is the React process that computes component updates. Reimplementing that process would require the parser to reproduce React behavior across versions. Instead, the parser constructs React components that call the interpreter when React renders them.

React and React DOM must share the dispatcher that selects hook implementations during rendering. Next’s bundled files expect aliases that plain Node module loading does not supply. The [scoped DOM loader](../src/materialize/react-dom-modules.ts) applies those aliases without changing Node’s shared cache or resolver. It loads framework React DOM code, not application component bodies.

React creates the fibers, which are internal records for elements and components. Each fiber has a work tag that identifies its category. Bippy records the fiber tree after a commit, the stage when React applies an update to its rendering target. It stores the tree and capture metadata in a snapshot.

### Derive states from a symbolic model

One source component can describe alternative trees. The primary model must retain the conditions for those alternatives rather than store only a list of trees. Otherwise, separate expressions that depend on the same input can produce impossible combinations.

The parser represents these conditions with guards, which are Boolean formulas over unknown inputs. State enumeration constructs individual trees from this model. Both enumeration and comparison use guards to reject incompatible choices.

The state space is the set of trees that this model describes. A bounded list of states is a query result, not a replacement for the model.

## Engine module boundaries

The renderer coordinates source loading, evaluation, materialization, and capture. Evaluation subsystems depend on the operations they need, not on that coordinator.

| Module                            | Owns                                                                                                |
| --------------------------------- | --------------------------------------------------------------------------------------------------- |
| `parse/source-types.ts`           | Source locations, parsed files, transforms, and AST declaration types                               |
| `graph/module-types.ts`           | Import/export records, bindings, and resolution results                                             |
| `symbolic/guards.ts`              | Symbolic inputs, predicates, and guard operations                                                   |
| `symbolic/serialization.ts`       | Guard and predicate schemas and serialization                                                       |
| `symbolic/guard-solver.ts`        | Constraint solving, independent of React trees                                                      |
| `evaluate/completion.ts`          | Statement completion, returns, jumps, and outcome joins                                             |
| `evaluate/scope-journal.ts`       | Scope snapshots, restoration, joining, and loop widening                                            |
| `evaluate/number-ranges.ts`       | Numeric interval construction, comparison, arithmetic, and rounding                                 |
| `evaluate/language-intrinsics.ts` | The isolated language realm, intrinsic identities, and canonical global paths                       |
| `evaluate/prototype-owners.ts`    | Weak prototype-to-class ownership metadata, without class evaluation                                |
| `evaluate/collection-values.ts`   | Weak collection identity and classification, independent of native conversion and iteration         |
| `evaluate/operators.ts`           | Unary/binary value operations and comparison derivation                                             |
| `evaluate/value-typeof.ts`        | Modeled JavaScript `typeof`                                                                         |
| `evaluate/method-signatures.ts`   | Host-declared method classification and callback receiver binding                                   |
| `evaluate/module-evaluator.ts`    | Module operations consumed by source-function construction and bundler import helpers               |
| `evaluate/array-methods.ts`       | Array construction, callbacks, searches, and mutations                                              |
| `evaluate/callbacks.ts`           | Callback invocation and conditional/repeated callback execution shared by arrays and React children |
| `evaluate/react-calls.ts`         | React API dispatch, wrappers, lazy loading, and root registration                                   |
| `evaluate/react-hooks.ts`         | Hook calls, reducer processing, external-store reads, and effect registration                       |
| `evaluate/hooks.ts`               | Per-instance hook cells, pending updates, memoization, and effect lifecycle                         |
| `evaluate/react-children.ts`      | Exact and uncertain child traversal, keys, and Flight deferral alternatives                         |
| `evaluate/react-elements.ts`      | Element props, keys, cloning, and construction without evaluation state                             |
| `evaluate/react-context.ts`       | Default and outer-provider value selection                                                          |
| `evaluate/string-methods.ts`      | String, number-formatting, and regular-expression methods                                           |
| `render/types.ts`                 | Render configuration, captured results, and replay decisions                                        |

`Interpreter` still coordinates evaluation and owns run state. `builtin-calls.ts` dispatches builtins and retains global and host-call handling. Neither is a foundation for its extracted subsystems: loops, array methods, and string methods accept explicit operation interfaces rather than the concrete interpreter. No adapter objects or forwarding classes are needed; the interpreter satisfies those interfaces directly.

Builtin and class evaluation also consume explicit contracts. Prototype construction requires only a function factory; class construction keeps its existing pending-super registry and cache lifetimes. Builtin dispatch composes array, function, module, and event operations without access to interpreter-private state. Abort, observer, event, resource-loading, and module-import helpers declare their own requirements. These contracts make dependencies explicit; they do not move module initialization out of the interpreter or make builtin dispatch a small subsystem.

React dispatch composes hook, callback, module-export, element-factory, and root-registration operations. Its subsystems do not import the dispatcher or interpreter. Hooks receive only their call, branch, diagnostic, provider-policy, and microtask operations. Children mapping shares conditional callback execution with arrays, not array-method semantics. Class components and materialization use provider lookup directly rather than importing the React API dispatcher.

Element construction needs only ownership and render-environment metadata. The public `Interpreter.createElement` method delegates to that implementation; API dispatch continues calling the supplied element factory so overrides remain effective. Direct subsystem tests exercise hooks, child traversal, element operations, and API dispatch without constructing an interpreter.

The harness owns fiber patterns, symbolic trees, comparison, enumeration, and replay. Both it and evaluation use the lower-level symbolic modules. The public package entry points continue exporting the relocated public types and guard utilities.

[Architecture tests](../tests/architecture.test.ts) enforce these import boundaries, including type-only dependencies. They also inspect the entire source graph for runtime cycles, including paths through unlisted modules, re-exports, literal dynamic imports, and package self-imports. [Negative-control tests](../tests/module-dependencies.test.ts) exercise the dependency reader and cycle detector.

The only permitted runtime cycle is `evaluate/values.ts` ↔ `evaluate/predicates.ts`: branch construction and truthiness use predicate information, while predicates inspect and construct branch values. This remains a coupled value-model subsystem, not an acyclic foundation. Type-only cycles also remain in the legacy engine. The tests do not claim to resolve imports whose specifiers are computed at runtime.

React API recognition no longer records value derivations; external member construction belongs to evaluation. Numeric ranges no longer import prototype inspection, and prototype ownership no longer requires class evaluation. Native member classification and language intrinsics no longer import event-listener execution. These boundaries remove concrete dependency cycles rather than just shorten files.

These boundaries do not change predicate allocation, async scheduling, branch semantics, budgets, or known compatibility gaps. In particular, scope-journal extraction does not change the lifetime of symbolic inputs. The [refactor review](./refactor-review.md) records the checks, corrected findings, and remaining limits.

## Analysis phases

[`StaticRenderer`](../src/render/static-renderer.ts) manages source preparation and model rendering. The comparison code then converts recorded fibers into a symbolic model and checks application captures against it.

The main operations are:

| Phase               | Implementation                                                                     | Result                                                            |
| ------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Project preparation | `createStaticRenderer` and `ModuleGraph` resolve configuration and source.         | The renderer can locate and parse the entry and its dependencies. |
| Model rendering     | `renderComponent` or `renderEntry` starts a fresh analysis and calls `finish`.     | React commits the model, and Bippy records its fibers.            |
| State analysis      | `enumerateStaticStates` reads the commits and constructs the symbolic state space. | The comparison code can query states, guards, and omissions.      |
| Verification        | `compareStaticToRuntime` and `replayEnumeratedStates` perform separate checks.     | Reports distinguish capture matches from replay evidence.         |

Evaluation and rendering are not separate passes over the entire application. The interpreter first determines the root element. React then renders component proxies, which ask the interpreter to evaluate more source and produce more elements.

The application capture follows a separate path. The application runs through its normal build and runtime while Bippy records its fibers. The model and application therefore use the same snapshot format but do not obtain their trees in the same way.

Before starting that application, the [corpus runner](../src/corpus/run-entry.ts) rejects an address that already has a listener. The check sends no page request and does not stop the existing service. Readiness probes have deadlines and reject responses after a recorded child exit. The runner keeps server stdin open until shutdown so tools such as CRA 3 do not exit on EOF. Install and setup commands still receive EOF; the runner does not set CI to keep a server alive. Another process can still bind the address during startup, so this does not prove server ownership.

Check the outer launcher as well as the application’s package manager. An outer `pnpm dlx` can change child Node options before the pinned runner starts. The [productivity launcher audit](../../../scratchpad.md#productivity-capture-and-launcher-audit) records a Node16 failure and a separate outer-version pin. Preserve the application’s original peer policy rather than silently changing it.

## Module resolution and run state

The parsed project can outlive an individual analysis. Evaluated module values cannot, because a replay must not reuse mutations from an earlier run.

### Resolve the application's build tools

A macro is build-time code that rewrites application source. Its output can change imports and component names. Modeling a macro import as a library alias can therefore produce a different tree from the application.

For Create React App projects, the [macro transform](../src/graph/babel-macros.ts) loads `babel-plugin-macros` from the installed `babel-preset-react-app` dependency. It uses the Babel compiler owned by `react-scripts`. The [installed-module loader](../src/libraries/installed-modules.ts) follows that dependency chain rather than assuming the project has one shared copy of each tool.

The transform runs on the application's `src` files when the preset declares the macro plugin. It explicitly enables class-field syntax for older Babel compilers without running the preset's class-field lowering. Macro configuration and code execute as build infrastructure.

For demos that import generated library files, preserve the original build lifecycles before capture. Verify generated files separately from the root and demo dependency trees. A frozen root install does not verify a nested demo’s dependencies. The [corpus runner](../src/corpus/run-entry.ts) runs installation commands at the repository root, regardless of `workingDirectory`.

The parser temporarily removes DOM-only globals and supplies the development compile environment. It restores the process directory, environment and DOM globals afterward. It interprets the transformed application source instead of executing application bodies. This integration does not run the complete Create React App Babel preset.

Build configuration can read variables that a client bundle does not expose. The [corpus renderer](../src/corpus/render-entry.ts) uses the entry’s child-process environment during native configuration loading and later renders. It serializes these operations because `process.env` is shared, then restores the harness environment even after failure. Inherited `CI` and package-manager variables follow the [dev-server rules](../src/corpus/dev-server.ts).

The [environment reader](../src/corpus/process-environment.ts) retains declared variables without requiring a dotenv file list. Without that list, it marks the environment as partial and preserves uncertainty about unlisted variables. Client exposure also remains unknown when neither the manifest nor a recognized tool establishes a prefix. Node configuration can read declared private variables regardless of the client prefix.

The [Vite configuration loader](../src/graph/vite-asset-transform.ts) uses the command-line mode when it calls the exported configuration function. An explicit command-line mode overrides `config.mode` when Vite filters plugins and runs `configResolved`. Without that override, Vite calls the function in development mode and then applies the configuration’s mode.

Vite plugins can skip transforms when their project paths differ from the source resolver’s paths. For automatic TanStack Router splitting, a skipped transform omits the application’s `Lazy` component from the analyzed tree. [Configuration discovery](../src/graph/vite-config.ts) therefore resolves directory symlinks before loading Vite.

Vite reads `NODE_ENV` before loading configuration modules. The parser supplies the development default when this variable is absent or empty. It removes an unchanged temporary default before resolution, preserving Vite’s original presence check for dotenv handling. The parser does not replace explicit inherited values.

Native Vite resolution also establishes the client environment, even when no user plugins remain. The interpreter reads exposed dotenv values and custom prefix arrays from that resolved environment. It uses Vite’s resolved `DEV` and `PROD` flags rather than assuming a development build.

The interpreter creates a mutable `import.meta.env` object for each client module and each analysis run. It allocates the object during module initialization, so conditional writes use the existing heap journal. Its initial properties follow Vite’s sorted serialization order. Literal define values override resolved fields, while unevaluated define expressions remain unknown.

Native Vite defines outside `import.meta.env.*` initialize mutable client globals, including dotted properties. The interpreter applies the serialized key order and preserves lexical shadowing. Opaque expressions remain unknown, and unsupported intermediate targets stop analysis instead of silently discarding a definition.

[Global property stores](../src/evaluate/global-properties.ts) track presence separately from value. A present `undefined` property differs from an absent property. Each property cell belongs to its store’s lifetime, so a branch must restore even a newly accessed cell. The shared heap journal joins assignments and deletions without losing their guards.

Client and server globals use separate stores, as do their builtin-object properties. When `process` is absent, an explicit `process.env.NODE_ENV` define creates that client object. Direct NODE_ENV expressions still follow Vite’s replacement rule.

Modeled assignments can change injected values. Global reflection and binding semantics remain partial.

The [module recorder](../src/graph/module-record.ts) uses the same `NODE_ENV` string as the interpreter. Otherwise, CommonJS exports could select development code while expressions select production code. The native adapter rejects non-string or unevaluated `NODE_ENV` replacements because they cannot select these branches safely.

These rules do not establish complete build-environment parity. Remaining parity checks include:

- Vite projects without a discovered configuration file
- Server-side Vite environments
- Reflective mutation and host-property descriptors
- Alternative assignment targets and writes to deleted bindings
- Environment changes from shell scripts and build tools outside native Vite resolution
- Build tools that read the native system environment instead of `process.env`
- Cached configuration with environment-dependent side effects
- Configuration branches that depend on unlisted variables

[Package metadata](../src/graph/installed-package.ts) also distinguishes a wrapper's package version from its declared bundled engine version. Vite asset URLs and compiler selection use the engine version when the package supplies it. They must not treat Vite Plus version `0.3.1` as Vite version `0`.

The [library registry](../src/libraries/index.ts) can model selected exports while the graph interprets other exports from opted-in packages. An analyzed namespace records its external specifier, so property reads apply the same overrides as named imports. Namespace materialization also uses those overrides.

For an allowlisted `mobx-react` package, unmodeled `Provider` and `inject` exports resolve to installed source. Existing [observer models](../src/libraries/mobx.ts) still take precedence; core MobX remains modeled. This policy does not establish complete observability or lifecycle behavior.

Expanding this source policy changes the analyzed model, not its saved native capture. Preserve both comparisons; higher coverage does not prove complete library semantics.

Native library calls can refuse interpreted callbacks, as a `lodash.map` call does for an interpreted JSX callback, and cannot run at all on a symbolic argument. The [native closure lift](../src/evaluate/native-closures.ts) resolves both without weakening the native-execution boundary: a function's own `toString` source is parsed, and the variables it closed over are read through V8's `[[Scopes]]` internal property over a `node:inspector` session ([closure inspection](../src/evaluate/closure-inspection.ts), after `js-cloudpickle`), so the function is evaluated by the interpreter over its captured state. Captured intrinsics (`Object.prototype.toString`) resolve to their canonical globals, and a captured stand-in resolves back to the interpreted function it stood for. A function whose first argument is of unknown kind is not lifted: a library dispatches on its subject's kind before it reads the rest, so every dispatch would fork and the result would say nothing about the program. Functions of the host document are never lifted. A class lifts too: its source is returned by a thunk the interpreter evaluates, so the class is defined (heritage, prototype, statics, fields) as the program's own classes are, and defined once so `instanceof` agrees across its instances; its parent comes from the class's `[[Prototype]]`, since the engine keeps a variable in a closure only when a function reads it, and a captured class is lifted the same way so a lifted class inherits from an interpreter class rather than an opaque native. Lifting does not establish complete library semantics: the lifted source is the installed one, and its result is only as precise as the interpreter's over that source.

A native run works on copies of the interpreter's containers, so it is a valid shortcut only while it leaves them alone. Each copy is remembered against the container it was lowered from, and a copy the call hands back (`identity(config)`, an item of `sortBy`'s result, a value read out of a `Map` it was stored in) resolves to that container rather than to a second one with the same contents, so `===` and later writes agree with the runtime. After the call, the copies are compared with the containers they came from; a call that wrote into an argument (`set(config, path, value)`, `pathToRegexp(path, keys)`) is discarded and re-evaluated through the lift, whose writes land on the interpreter's own heap. This is what lets `deepmerge` run as a pure package rather than a hand-written model: its `clone: false` identity and its callback options hold under the lift.

A native run is also only valid while the function's answer depends on its arguments alone. Run natively, `isToday(date)`, `formatDistanceToNow(date)` or `random(1, 6)` would answer with the analysis's own time or draw, a constant the render does not have. [Environment reads](../src/evaluate/environment-reads.ts) finds such functions before they run: the same parsed source the lift uses is scanned for `Date.now()`, `new Date()`, `Math.random()`, `performance.now()` and `crypto` draws, under the global's own name, an alias the closure captured (`nativeRandom = Math.random`, `root.Date.now()`), or a member of any object named after it; and the scan follows the closure to every function the source may call, a captured function or a member read off a captured module object (`_index.constructNow`), so `isToday` is found to read the clock through `constructNow`. Such a function is never run natively; it is evaluated from source over the interpreter's models of the clock and of `Math.random`, so its result carries the dependency (`isToday(fixed)` is undecided, `startOfToday()` is a date of the wall clock) rather than a stale constant. The scan is cheap (parsing is shared with the lift, and only the closure variables the source names are read) and it replaces the per-package lists of clock- and randomness-reading exports; exports that read or write module state (a locale, a counter) remain listed, since a native run and a lifted run would each see their own copy of that state.

Record legacy-router source policies separately from [framework model selection](../src/frameworks/react-router.ts). An opaque provider can hide which route children the library mounts. Interpreting installed router and context helpers can expose those children without establishing complete navigation or lifecycle behavior.

Assigned stub names are not yet fully symbolic. For unknown or branched `displayName` values, the [name reader](../src/evaluate/values.ts) falls back to the library name. Interpreting a missing naming helper can resolve the value without repairing that fallback. Preserve the earlier mismatch and replay evidence.

Native Vite configuration does not yet connect `resolve.alias` to the [module resolver](../src/graph/module-resolver.ts). A configured alias can remain opaque even when the browser resolves it. Explicit parser aliases and TypeScript paths are separate.

A library model needs the component structure of the installed version. The [Emotion model](../src/libraries/emotion.ts) includes an `Insertion` component before styled content starting in Emotion 11.8. Earlier Emotion 11 releases render that content directly. The wrong structure can disagree with application fibers while its internal replay passes.

The [legacy Next image model](../src/frameworks/next-legacy-image.ts) also uses version-specific host structure. Next 10 and 11 use `div` wrappers; Next 12 uses `span` wrappers. Next 10.1 through 11.1.0 condition the `noscript` fallback on intersection visibility. The model retains both outputs when that visibility is unknown.

For Next 13.2, the [metadata adapter](../src/frameworks/next-metadata.ts) interprets installed metadata helpers instead of inventing tags. It passes interpreted layout and page exports through those helpers. Application bodies do not execute natively.

Metadata appears at the first router boundary, inside its template and loading boundary. A grouped root layout can put metadata outside the `body` subtree. Comparisons restricted to that subtree cannot check those metadata fibers.

The adapter leaves these inputs unknown:

- File-based metadata that requires the image loader
- Catch-all metadata parameters
- Parallel-route metadata collection

Other Next metadata APIs remain outside this contract. Successful initial renders do not prove streaming or error-recovery parity.

### Scope router inputs to each provider

A router’s basename is the URL prefix excluded from its route paths. The [React Router model](../src/frameworks/react-router.ts) removes that prefix before matching routes. A nonmatching known prefix renders no router children. The link models use the same local pathname and basename.

For a fixed analyzed URL, the model stores one location object per mounted router instance. A change in the normalized basename replaces that object. Returning to an earlier prefix does not restore its old object. An unchanged basename preserves identity, so unrelated parent updates do not invalidate memoized location consumers.

An unknown basename does not justify an empty tree. `useHref` resolves static paths that start with one `/` and contain no `..` segment. Other target forms stay unknown. These checks cover browser routing, not complete navigation or hash and memory histories.

### Resolve declarations without executing modules

The [source parser](../src/parse/parse-source-file.ts) uses `oxc-parser` to build an abstract syntax tree. This tree describes source expressions and statements. `SourceFileCache` reuses parsed files and checks file metadata for changes.

The [module graph](../src/graph/module-graph.ts) records declarations and module dependencies. Its resolver uses `oxc-resolver` with package conditions and project paths to locate dependencies. The graph follows exports across modules and reports missing or ambiguous exports. Internal star exports compare defining bindings rather than selecting the first match. [Module graph research](module-graph-research.md) records the source review, regression cases, cross-tool disagreements, and remaining parity work.

An explicitly analyzed framework module also enables its relative source dependencies. Bare package imports retain their existing policy unless the adapter explicitly selects another module.

Resolving an export identifies its declaration. The interpreter evaluates that declaration when analysis needs its value. This separates the reusable source representation from values that can change during a render.

During module initialization, property-read initializers run in statement order. Deferring those reads could capture a later mutation instead of the initial value.

A dependency can remain external to source analysis. The interpreter can use an external-value model or preserve uncertainty about the dependency. Options control which external packages the parser analyzes from source.

### Reuse the project, not evaluated state

`StaticRenderer.derive` creates a renderer that shares the parsed project with its parent. Each render still calls `startRun`, which creates a fresh interpreter and document environment. This avoids reparsing the project for every replay without sharing evaluated application state.

Keep source and project inputs fixed across these runs. `derive` does not reload changed files or configuration. The graph retains loaded records and missing-file results, while later reads of previously unloaded files can see newer bytes. It is neither a live filesystem view nor an atomic snapshot. The [graph lifetime probes](module-graph-research.md#graph-lifetime-probes) distinguish graph, resolver and transformed-source cache behavior. Constructing a new renderer sees the tested source edit, but general watch-mode refresh and coherent reads during edits remain unimplemented.

A [scope](../src/evaluate/scope.ts) maps names to interpreted values and refers to a parent scope. Looking up a name searches the current scope and then its parents. Function values retain their source body and scope, so the interpreter can evaluate closures.

JSX `this` tags use the current receiver rather than a variable named `this`. For example, [`<this.Views.Leaf />`](../tests/components/jsx-this-members.tsx) reads the receiver, then its two properties. `<this />` uses the receiver directly.

Arrow functions retain their lexical receiver; ordinary calls use their call receiver. Other bare lowercase tags still name host elements.

A result can also depend on captured observations, such as configuration or store state. Those observations are inputs to the analysis. A tree that matches under those inputs does not establish a match for every possible response or store value.

## Conditional evaluation

The [interpreter](../src/evaluate/interpreter.ts) evaluates source with `StaticValue` records. A record can describe an exact value or alternative values, including values within objects and collections. When the model cannot determine a value, it records uncertainty and a reason.

Numeric `Math` arguments retain guarded alternatives when their Cartesian product fits the existing eight-combination limit. This preserves finite slice bounds instead of replacing them with an unknown number. Other argument kinds and larger products retain their conservative handling.

The `find` family, `some`, and `every` capture a definite initial length and read live elements in the method’s direction. Results that stop traversal also prevent later predicate calls. The model preserves callback receivers and propagates thrown predicates without escaping them. Quantifiers skip indices that the model identifies as absent, retaining explicit unknown decisions when presence remains unresolved.

The list representation does not distinguish sparse holes from present `undefined` values.

### Preserve relationships between expressions

A branch value records alternatives for an unresolved condition. The [predicate model](../src/evaluate/predicates.ts) relates those alternatives to symbolic inputs. A symbolic input represents data whose value the analysis does not know.

The following component tests the same `role` value twice. The local `isAdmin` variable does not make the second test independent:

```tsx {6-10}
interface ToolbarProps {
  role: string;
}

export const Toolbar = ({ role }: ToolbarProps) => {
  const isAdmin = role === "admin";
  return (
    <nav>
      {isAdmin && <button type="button">settings</button>}
      {role === "admin" && <a href="/audit">audit</a>}
    </nav>
  );
};
```

Treating the tests as independent decisions would permit four combinations. Only two are valid for this component. The button and link both appear when `role` equals `admin`, and neither appears otherwise.

The predicate model preserves that relationship through the assignment to `isAdmin`. Input provenance relates a guard to the source of its uncertainty. Each input has an identifier and source information. That information describes the input category and source location when available.

For resolved alternatives, calls constrain closure reads with the current choice and the caller’s guard. Each receiver path evaluates its own arguments. The interpreter restores the caller’s guard afterward and joins mutations under the original decision.

### Restore mutations between alternatives

Evaluating both sides of a condition can change shared state. If the interpreter retains mutations from the first side, the second side starts with the wrong values. This can produce a tree that neither path produces in the application.

[`HeapJournal`](../src/evaluate/heap-journal.ts) records conditional changes to shared interpreted state. At the end of a path, it saves the changed values and restores the previous values. After evaluation of the alternatives, it combines their results under the branch conditions.

For collections, the journal shares [read-only entry tables](../src/evaluate/collections.ts) across captures and restores. It copies a shared table before a write and reuses identical tables when joining paths. This sharing does not change application object identity. React still [compares application `getSnapshot()` values with `Object.is`](https://github.com/facebook/react/blob/82c44beb444eda5230c063eaa163d01f38817211/packages/react-reconciler/src/ReactFiberHooks.js#L1681).

For finite, nonrepeated list mutations, the journal joins values by position and guards whether each position exists. Spreading finite list alternatives preserves those guards. Guarded length sums handle definite prefixes and distribute independent counts within the shared 16-pair limit.

These changes preserve the shared list’s identity. Unbounded mutation counts still use repeats, and larger length-sum products retain uncertainty.

The journal distinguishes preexisting objects from objects allocated within a path. An object allocated inside one alternative does not need restoration for another alternative that cannot reference it. Pending hook updates also require this distinction because an update must remain conditional on the path that schedules it.

Conditional reads require the same guards as writes. The interpreter narrows a value when the active conditions identify a compatible subset of its alternatives. Journaling writes alone would still permit a callback to read a value from an incompatible path.

### Preserve state through abrupt exits

Statement outcomes record a guarded completion condition separately from returned or thrown values. Later statements run under the completing paths’ guards. A possibly throwing initializer also guards the remaining declarations in its statement.

Inside `try`, the interpreter retains local state from abrupt paths until a handler or finalizer can read it. Catch selection uses the original throw condition. [Filtering thrown or surviving alternatives](../src/evaluate/thrown.ts) preserves their guards and preferences, including error payloads.

Finalizers run on both completing and exiting paths. Heap journals join terminal paths immediately; paths that jump within a loop retain deferred handling. The [throw-path regressions](../tests/throw-paths.test.ts) check these bounded cases, not complete exception, loop, or async semantics.

Logical assignments also separate kept and assigned paths. `||=`, `&&=`, and `??=` skip the right-hand operand and the write when the current value suffices. A throwing read or right-hand operand stops the remaining operation. The [logical-assignment regressions](../tests/logical-assignment.test.ts) check guards, side effects, and kept object identity.

Assignment references separate target evaluation from reading and writing. The interpreter captures receivers and computed-key expressions before the right-hand operand. Compound, logical, and update operations reuse those references. Successful operands reach the write; thrown operands and object setters propagate their errors. The [reference regressions](../tests/assignment-reference.test.ts) also check receiver replacement and correlated keys.

[Primitive updates](../tests/update-primitives.test.ts) coerce the old value before arithmetic. Postfix returns that converted value; prefix returns the new value. BigInt updates retain BigInt arithmetic, while object and symbol coercion remain unverified.

[Calls preserve throwing argument guards](../tests/call-argument-throws.test.ts) when deciding whether to invoke the callee. [Argument evaluation](../tests/argument-order.test.ts) now stops later expressions on throwing paths. Successful paths retain their argument values, guards, and side effects.

Ordinary arguments use an iterative loop. Throwing alternatives and finite spread alternatives continue under their selected guards. The tests check spread-expression failures and finite arity, not complete iterator semantics.

Method calls capture the callee and receiver together after evaluating the receiver and key. This avoids repeating getter effects. Equivalent receiver-independent targets can share an invocation without repeating argument evaluation.

[Constructor completion](../tests/constructor-completion.test.ts) now preserves body and field-initializer failures. A failed initializer stops later fields and the constructor body. Direct object returns replace the instance, while known thrown outcomes propagate through `super()` and construction.

Parent-construction status lives in a journaled object rather than an untracked local boolean. This preserves guarded retries after parent failures. React class rendering and lifecycle callbacks run only on completing constructor paths. Path-dependent React replacement instances remain conservative. These tests do not establish complete class or StrictMode semantics.

[Derived constructor bindings](../tests/derived-this.test.ts) retain the object returned by the parent and reject reads of uninitialized `this`. Derived fields use that object. Arrows capture the live binding; nested non-arrow functions keep their own receivers. Compiled function wrappers do not acquire native-class `this` checks.

Known receiver and key failures stop member evaluation. Optional finite receiver alternatives skip keys on absent paths. Declared instance `super` getters run when their property is read, after key evaluation, rather than while assembling the parent-member view. Parent replacements require a known `object` value; other modeled value kinds remain unknown.

[Class identity tests](../tests/class-identity.test.ts) check fresh allocation on native-class `super()` attempts, including retries and duplicate calls. Failed instances retain their earlier fields and identity. React adopts the common completing instance before reading its state; incompatible path-dependent instances remain conservative.

Declared class methods are no longer implicitly bound. Member calls supply a receiver, while extracted methods default to `undefined`. Explicit binds and lexical arrows retain their receivers. React’s instance lifecycle helpers supply the instance explicitly.

[Escape walks](../tests/escapes-receivers.test.ts) retain receivers for resolved member callees. Receiver-specific cache entries terminate recursive walks and support invalidation after mutations. Passing a method as an argument does not bind it.

[Class result tests](../tests/class-results.test.ts) require derived constructors to reject known non-undefined primitive types even when their values are unknown. This covers unknown numeric and string returns, including guarded returns. Base constructors still ignore primitive results.

React’s calls to `getDerivedStateFromProps` and `getDerivedStateFromError` now supply an undefined receiver, matching its extracted calls. Explicitly bound callbacks and static arrows retain their receivers. These checks do not establish complete class lifecycle or StrictMode behavior.

[Nullish property tests](../tests/nullish-properties.test.ts) preserve read and write failures for concrete `null` and `undefined` receivers. Computed-key expressions still run first. Simple assignments evaluate their right-hand side before the write fails; reads and compound assignments stop before later operands or arguments. `typeof` preserves property-read errors. Error names are known, while engine-specific messages remain unknown.

[Property effect tests](../tests/property-effects.test.ts) run getter reads under the selected receiver’s guards. Getter mutations no longer leak onto a null-receiver path. Deletion sequences receiver and key evaluation, preserving earlier failures and nullish errors.

Proxy writes preserve failures from retrieving or calling the `set` trap. Trap calls use the handler as their receiver, and successful delegation retains the proxy’s identity. [Proxy setter tests](../tests/proxy-receivers.test.ts) distinguish the lookup target from the original receiver. Nested delegation passes that receiver to setters and inner traps. Guarded targets preserve setter failures and isolate effects; explicit bindings still take precedence. This does not establish complete proxy semantics.

[Property-presence tests](../tests/property-presence.test.ts) keep conditional keys separate from present `undefined` values. `in` and `hasOwnProperty` retain the original guards. Explicit `undefined` shadows earlier values, and finite spread snapshots retain values and presence after the source changes. Whole-object joins no longer restore the original entries after deletion.

[Proxy read tests](../tests/proxy-reads.test.ts) cover getter-backed trap lookup, handler receivers, null-trap fallback, and original receivers through nested delegation and ordinary object getters. Lookup failures stop later call arguments; explicit bindings keep their receiver.

[Trap-method tests](../tests/proxy-methods.test.ts) reject `get` and `set` traps whose modeled type is known not to be a function. Lookup effects and guards remain intact, nullish traps fall back, and unknown types retain existing call handling. An object does not become callable by defining `call` or an `apply` trap.

[Strict-write tests](../tests/strict-writes.test.ts) reject getter-only assignments and falsy proxy-set results in strict code. Trap effects survive rejection; an ordinary setter's return value does not determine write success. [Scope checks](../tests/strict-write-scopes.test.ts) distinguish lexical directives and class methods from caller strictness, block strings, and escaped directives. References retain their source strictness through delegation. Module classification comes from `ModuleRecord`; script/loader modes, eval, and dynamic function constructors remain unverified.

[Class-heritage tests](../tests/class-heritage.test.ts) stop class creation when evaluating the superclass throws, before member keys or static initialization run. Completing superclass alternatives retain their guards and inherited values. Class declarations propagate these abrupt paths rather than storing them as bindings. [Comma-expression tests](../tests/sequence-completion.test.ts) stop later operands and calls after an earlier error, retain the last completing value, and preserve unbound call receivers. A 10,000-operand control checks iterative sequencing, not general scalability.

[Computed-key tests](../tests/class-keys.test.ts) evaluate class member names before static initialization. A throwing key stops later keys, class creation, and constructor-call arguments. Finite key alternatives retain their guards and distinct class members. Instance field values remain deferred. A 10,000-key control checks iterative concrete-key sequencing. Effectful object-key coercion and class-name temporal dead zones remain unverified.

[Callable-property tests](../tests/callable-properties.test.ts) cover guarded function/class writes, property presence, inherited fallback, explicit undefined, deletion, and prototype ownership. Function and class values share journaled object storage with their React component definitions. Prototypes are initialized before guarded program work, rather than first access inside a branch. Method, arrow, async, generator, and bound-function controls distinguish own prototype shape; this is not an `IsConstructor` implementation. Descriptor-sensitive writes, instance-method metadata, wrapper mutations, and complete reflection remain unverified.

[Static-initializer tests](../tests/static-initializers.test.ts) preserve field and block errors before later static work. A failed field initializer does not replace an existing method or create its field. Guarded failures retain the observable state of an escaped partial class. Static blocks have a separate scope and completion boundary; handled errors and finalizer effects remain visible. Mixed return/jump paths can still run later iteration effects on a thrown path.

[Loop-continuation tests](../tests/loop-completion.test.ts) cover body returns and throws in `for`, `while`, `do…while`, and known `for…of`/`for…in` iterations. Surviving paths run remaining iterations before the enclosing fork rejoins terminal state. A completion-depth marker follows actual terminal/completing forks, rather than structural guard changes. Post-loop statements retain the body's completion predicate. Ordinary iterations remain iterative, including a 10,000-item control. Mixed jumps, optional iterations, iterator semantics, and per-iteration lexical bindings remain unverified.

[Loop-expression tests](../tests/loop-expressions.test.ts) preserve errors in `for` initializers, conditional-loop tests, and `for` updates. Declaration headers use the original statement evaluator, so a failed declarator stops later declarations. Successful test paths reuse the evaluated value rather than rerunning an effectful test. Header and body errors skip later work while preserving prior effects and thrown payloads. Ordinary iterations remain iterative. Uncertain loop-tail evaluation remains unverified.

[Loop-source tests](../tests/loop-sources.test.ts) preserve right-hand expression errors before `for…of`/`for…in` iteration extraction. The expression runs once; completing paths retain their value and context. Errors skip assignment-target evaluation and body effects. Iterator acquisition, interleaving and closing, invalid iterables, and loop-head temporal dead zones remain unverified.

[Value-level checks](../tests/property-presence-values.test.ts) verify guards, snapshot isolation, conservative key enumeration, and nested-spread causes. Conditional entries do not hide unrelated getters and setters. Descriptor behavior, key order, object-key coercion, complete destructuring, optional deletion, and nonconfigurable-property behavior remain unverified. Preserved counterexamples expose these remaining gaps:

- Frozen-object and primitive-property write errors
- Superclass constructor/prototype validation and descriptor-sensitive field definition errors
- Eager static getter evaluation, class-name temporal dead zones, and descriptor-sensitive class property writes
- Direct boolean interpolation losing guard precision
- `defineProperty` trap dispatch during ordinary proxy writes
- Noncallable `apply` traps and class calls without `new`
- Guarded `Object.freeze` state and frozen-target read invariants

An unconstrained text node can match a native snapshot without establishing the source-derived concrete outcomes.

### Preserve identity as well as conditions

Two equal-looking objects need not be the same object. Two references to the same function must retain that identity. The [value implementation](../src/evaluate/values.ts) therefore records allocation identity separately from symbolic conditions.

Timer handles retain resource identity even when their numeric ranges match. The queue uses that identity for cancellation after the interpreter copies a value.

Component identity has the same requirement. Creating a wrapper component twice can create two component types, even when both wrappers use the same source body. The materializer uses source closure identity rather than component names alone to identify component proxies.

React can mount the same element object in two positions. Those positions have separate component instances. The materializer distinguishes repeated element occurrences within each decision scope when it caches their React elements.

Equal props do not establish a repeated render input. A nested provider can change the context while the component calls itself with unchanged props. The recursion check therefore compares the ancestor’s recorded context reads as well as its closure and props.

Context comparisons preserve object identity rather than comparing object fields. Recursion probes do not become application context dependencies, because that could invalidate an unrelated memoized child.

These checks still cannot prove that recursion never terminates. A cutoff produces an unknown subtree, and the configured depth limit still applies.

## Rendering with React

The [materializer](../src/materialize/materializer.ts) converts interpreted values into real React elements. Each source component becomes a proxy component whose render calls the interpreter. The proxy never calls the application function itself.

### Represent uncertainty in the fiber tree

React requires elements to render, so an unknown value cannot remain only an interpreter record. The materializer converts uncertain structures into [marker components](../src/materialize/markers.ts). Their fibers record where the uncertainty occurs:

| Marker                       | Meaning                                                                       |
| ---------------------------- | ----------------------------------------------------------------------------- |
| `$Branch` and `$Alternative` | The model contains alternative element trees.                                 |
| `$Repeat`                    | The model contains a collection with an unknown length.                       |
| `$Opaque`                    | The model does not describe a component body but retains its passed children. |
| `$Unknown`                   | The model cannot determine this part of the tree.                             |
| `$Text`                      | The model records text without its exact content.                             |

React can render alternative branches together in one analysis run. Their simultaneous fibers represent alternatives, not a claim that the application displays all alternatives together. The heap journal and commit guards must account for this difference.

### Preserve caught values

An error boundary can choose its fallback from the value a child throws. A replacement object can change that choice, even when its message resembles the original error.

The proxy therefore retains the interpreted thrown value while React locates the boundary. The [class renderer](../src/evaluate/class-component.ts) passes that value to `getDerivedStateFromError`, preserving primitive values and object identity.

When every branch throws, [caught-value extraction](../src/evaluate/thrown.ts) maps the payloads without creating a new decision. Otherwise, the model could pair an error with the condition that selects a different error.

The current class model does not invoke `componentDidCatch`. Mixed throwing and nonthrowing paths still need cause-preserving validation.

### Coordinate hooks with React commits

Each stateful proxy has a `HookFrame`, which stores interpreted hook state. The proxy also uses real React hooks to request another render and schedule effect processing. This lets React control when the proxy renders while the interpreter controls the values that application hooks observe.

[React queues reducer actions at dispatch](https://github.com/facebook/react/blob/82c44beb444eda5230c063eaa163d01f38817211/packages/react-reconciler/src/ReactFiberHooks.js#L3583) and applies them during rendering. The interpreter also queues directly evaluated `useReducer` dispatches. The next hook pass uses that render’s reducer closure, preserving action order and object identity. Conditional queues retain their branch guards through the heap journal.

Reducers run before the materializer decides whether unchanged state permits reusing a previous render. Reusing that render also preserves its effects. Failed reducer branches retain their actions for error recovery, rather than storing errors as state. For React 19+, Strict Mode duplicates normal update checks but not render-phase reducer updates.

These queues don’t model React’s lane priorities or every escaped callback’s timing.

The proxy processes modeled layout effects through its React layout effect. It processes modeled passive effects through its React passive effect. The materializer must preserve update conditions across those calls, including updates that affect later commits.

The following component removes `Trigger` after its effect updates the parent. Canvas context creation can return a context or `null`:

```tsx {8,14-19}
import { useEffect, useState } from "react";

interface TriggerProps {
  onReady: () => void;
}

const Trigger = ({ onReady }: TriggerProps) => {
  useEffect(() => onReady(), [onReady]);
  return <canvas />;
};

export default () => {
  const [isReady, setReady] = useState(false);
  const [context] = useState(() => {
    return document.createElement("canvas").getContext("2d");
  });
  if (isReady) return <strong>ready</strong>;
  const handleReady = () => setReady(true);
  return <main>{context ? <Trigger onReady={handleReady} /> : <aside />}</main>;
};
```

The final `<strong>` tree no longer contains the condition on `context`. Its existence still requires a context, because only `Trigger` schedules the update. A model that records only the final tree loses that requirement.

[`CommitCauses`](../src/materialize/commit-causes.ts) records the conditions under which modeled updates occur. Nested causes require both conditions. Independent causes that each suffice for an update permit either condition.

Effects and ref callbacks use conditional mutation evaluation, so their writes retain those causes. The render result associates the resulting commit causes with its recorded trees. The state analysis can then reject a later tree whose cause conflicts with the selected inputs.

### Bind deferred work to its scheduling conditions

A deferred callback can run after an unrelated commit. Using conditions from that commit would associate the callback with the wrong inputs. Modeled tasks instead retain the conditions that applied when analysis scheduled them.

The [timer queue](../src/evaluate/timers.ts) also records cancellation as journaled state. The same state keeps timers inactive on paths that never schedule them. If a conditional child cancels a shared timer, the timer remains active on paths without that child. Callback execution uses both the scheduling and cancellation conditions. Cancellation through a conditional handle uses the selection condition for each handle.

Direct `queueMicrotask` calls use the same activation checks without exposing a cancellation handle to application code. The queue records activation when it enqueues work, not when the interpreter allocates a handle. Cancellation does not count as an update when the queue has no record of the handle.

[Promise reactions](../src/evaluate/promises.ts) record activation when a handler subscribes, even if the promise is still pending. A reaction uses both its registration condition and its settlement condition. Journaled promise state keeps settlement on one path from changing another path. `Promise.all` records each input reaction's completion separately instead of sharing a counter across paths.

Task callbacks also journal their writes under the full execution condition. This matters when a conditional component schedules a callback that later changes a shared store. Checking that the callback can run is not enough to restrict its writes.

A promise that adopts another promise enters a following state. Later resolver calls cannot replace that state. Adoption jobs and `finally` continuations run through the microtask queue. Self-resolution rejects with a `TypeError`.

A modeled leading `await` resumes in a reaction microtask even when its operand is a primitive or a settled promise. It does not drain unrelated microtasks while evaluating the operand. An exception thrown before reaching the await remains synchronous; a rejected promise resumes the catch block through the reaction queue.

Promise support remains incomplete. Thenable behavior, custom promise constructors, escaped or widened outcomes, non-leading await expressions, and render-local suspension still require verification.

[Mounting](../src/materialize/mount.ts) runs React updates and modeled tasks within a bounded settlement period. It records committed trees before it unmounts the root and removes instrumentation. If unmounting throws, it still restores console handlers and releases the recorder and container. When rendering and unmounting both fail, an aggregate retains both errors, including thrown `null` or `undefined`. A cleanup failure remains a failed analysis. Reaching the settlement limit does not prove that the application has no further updates.

## Symbolic states

The [pattern reader](../src/harness/static-pattern.ts) converts recorded fibers into comparison patterns. A pattern describes known fibers and uncertain regions. Marker fibers become branch, repeat, opaque, or wildcard pattern nodes.

An opaque node represents a component with an unmodeled body. A wildcard permits structure that the analysis cannot determine. Neither node establishes the exact structure of the region that it represents.

### Keep commits and causes together

The [symbolic tree](../src/harness/symbolic-tree.ts) stores symbolic inputs and guarded commit patterns. Each commit has a tree and a guard. A guard restricts when that committed tree can occur in the model.

Commit guards matter even when two commits have the same visible tree. Combining identical patterns must retain the conditions that permit either occurrence. Otherwise, deduplication changes which inputs appear to produce the tree.

### Enumerate related decisions together

The [state-space implementation](../src/harness/state-space.ts) groups decisions that share inputs. A guard solver checks whether their conditions permit a common assignment of values. Independent groups do not require immediate enumeration of every combined state.

A wide group can exhaust JavaScript’s call stack before it reaches the state budget. The [cluster enumerator](../src/harness/enumerate-states.ts) therefore schedules continuations on an explicit work stack. It schedules guard cleanup after each path, preserving depth-first choice and omission order. This removes sibling-count stack growth without raising enumeration or repetition budgets.

For two independent Boolean inputs, each group has two local assignments. The full combination has four assignments. Grouping lets the model retain the local choices without constructing all four trees before a query needs them.

The implementation constructs complete state patterns on demand, within a state budget. It records omitted alternatives and repeat counts instead of treating the enumerated list as exhaustive. A state with all branch decisions selected can still contain opaque nodes or wildcards.

## Comparison and replay

Application comparison and replay check different properties of the model. Application comparison asks whether a capture matches a modeled state. Replay asks whether a combined analysis agrees with separate analyses under selected decisions.

### Match an application capture

[`compareStaticToRuntime`](../src/harness/compare-render.ts) checks whether an application tree matches the symbolic model. This test is membership checking. It can search the symbolic tree without requiring the matching state in the initial enumerated list.

The [matcher](../src/harness/compare.ts) drives suspended calls through an [explicit work stack](../src/harness/work-stack.ts). Generator frames keep decision constraints active while descendant calls run. The driver resumes a frame with its child’s result or throws its error into that frame. Its `finally` blocks release constraints during completion, backtracking, and errors. A wide sibling list or repeat therefore does not consume one JavaScript frame per step.

The work stack does not raise the matching step budget. Recursive tree indexing and guard-solver resource bounds remain separate limits. Enumeration success still does not establish that comparison will complete.

Check `budgetExhausted` when a comparison reports `mismatch`. If true, the search found no witness within its budget. That does not prove the capture is absent from the model. The recorded divergence describes the search, not a proven parser defect.

Check evaluation diagnostics even when the matcher’s `budgetExhausted` flag is false. Evaluation can replace a component body with a wildcard after a step or call-depth cutoff. A partial match through that wildcard does not validate the missing body. The [Elden Ring capture](../../../scratchpad.md#evaluator-limited-elden-ring-import) records three matching steps alongside eighteen evaluation-budget cutoffs.

The comparison checks fiber structure. It also compares these recorded fields:

- Component names
- Work tags
- Element keys
- Text nodes

Opaque nodes and wildcards permit broader matches, which the report distinguishes from exact matches. Such a match does not validate the full contents of the uncertain region.

A framework profile identifies framework fibers to ignore or treat as transparent during comparison. This accounts for framework structure without requiring the model to reproduce every runtime wrapper. These rules must not conceal differences in application components.

An `exact` membership result applies to the captured state and the comparison rules. It does not prove that every modeled state is reachable. Fiber coverage measures recorded fibers, while guard coverage reports which alternatives the captures demonstrate.

### Render selected decisions again

[`replayEnumeratedStates`](../src/harness/state-replay.ts) creates a fresh interpreter and materializer for each sampled decision assignment. A pinned decision selects one branch alternative or repeat count instead of rendering all alternatives together. This can expose shared-state interference that the combined render failed to prevent.

The materializer records selected input guards for task checks. It does not use these assumptions to narrow ordinary render values. That narrowing can remove branch markers and cause React to remount their children. Iteration-local inputs and synthetic choices do not become global task assumptions.

Replay uses the same interpreter implementation. It is not an independent execution of application source. A model error that affects both the combined render and the replay can remain undetected.

Many Games’ [saved comparisons](../../../scratchpad.md#six-original-second-game-captures) demonstrate this gap. Replay passes, but independent capture lacks a loading placeholder that the model retains.

The replay claim describes what the symbolic model predicts under the selected decisions. The implementation derives this claim from all symbolic commits, not a truncated list of enumerated states. Otherwise, a state budget could remove a later commit from the claim and create a false contradiction.

An undecided condition or unknown region can leave the claim incomplete. Complete comparisons check the claimed and replayed tree sequences. Incomplete comparisons check known regions without treating unknown regions as contradictions.

An incomplete replay without a contradiction preserves the original capture match but does not count as a replay pass. A replay without a tree remains incomplete, not evidence of an empty tree. Known differences in available trees still count as contradictions. A contradiction against the matched assignment can invalidate that match when no replay-witnessed state matches the capture.

The replay summary uses these verification values:

| Value               | Meaning                                                                             |
| ------------------- | ----------------------------------------------------------------------------------- |
| `not-replayed`      | The check ran no replay assignments.                                                |
| `sample-passed`     | The sampled comparisons were complete and found no contradiction.                   |
| `sample-incomplete` | At least one sampled comparison remains incomplete, and none found a contradiction. |
| `contradicted`      | At least one sampled comparison found a contradiction.                              |

A zero replay budget disables replay. A passing sample applies only to the assignments that the check ran. Older summaries can omit verification fields, which means the evidence is unrecorded.

When a match lies outside enumeration, replay prioritizes its conditions within the existing replay budget. The `matchedOutsideEnumeration` field records that candidate’s verification separately. A compatible enumerated assignment can supply its pins without adding another candidate. Reuse also requires that the assignment permits the matched commit’s cause.

### Retain contradictions after correction

A concrete replay can replace contradicted enumerated states before another membership check. That correction retains the `contradicted` verification result. A successful match after correction does not erase the original disagreement. Replay does not append witnesses outside enumeration or increase the state count to include them.

Corrections currently change the state array without changing the original symbolic tree or decision groups. This is an unresolved inconsistency in the implementation. Replay corrections therefore supply evidence, not a repaired primary model.

## Implementation limits

The current renderer uses React DOM and the happy-dom implementation of the Document Object Model. The [runtime loader](../src/materialize/react-runtime.ts) resolves application React packages or framework-specific replacements. It can use the analysis package versions when application packages are unavailable or lack the required support.

The runtime uses its React module’s `act` or `unstable_act` export when available. A Bippy-recorded hook probe checks runtime compatibility. Failed probes release their recorder and restore console output before fallback.

A host model defines available platform names and modeled behavior. Host declarations for React Native do not establish native renderer support. Fiber-only comparison also misses scalar host text that React stores without a separate text fiber.

[Framework adapters](../README.md#frameworks-srcframeworks) select roots and compose framework-specific trees. With server component support enabled, the interpreter evaluates server bodies without client fiber boundaries. Client components retain their fiber boundaries.

The guard model supports selected comparisons, not every JavaScript constraint. Expression limits can discard condition detail, and evaluation limits can produce unknown values. A solver result applies to the represented conditions, not to every behavior of the original program.

Task registration and captured lexical variables still require further isolation checks. Lifecycle scheduling also needs further verification. Partial replay comparison does not establish every commit order or unresolved cause. The [execution plan](../../../scratchpad.md#7-workstream-p1-effect-cause-guards-and-reachable-commits) records these gaps.

The [witness planner](../src/harness/witness-plan.ts) proposes input assignments for guard alternatives without runtime evidence. A runtime witness is an application capture that demonstrates an alternative. The planner does not execute browser actions or establish coverage of event sequences.

The parser has not established that every modeled state is reachable or that every reachable state appears in the model. Interpret membership results alongside replay verification and any reported omissions. The [state-model design](exhaustive-states.md) describes the intended guarantees. The [documentation plan](../../../scratchpad.md#architecture-documentation-plan) records the scope of this page.
