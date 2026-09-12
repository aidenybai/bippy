---
meta:
  title: How the parser builds and checks React trees
  navLabel: Understand Parser Architecture
  contentType: Conceptual
  category: Architecture
  plan: ../scratchpad.md#architecture-documentation-plan
---

# How the parser builds and checks React trees

This document explains how `@bippy/parser` builds a model of a React application and checks it against application captures. It describes the data structures and design decisions so you can understand and modify the implementation. It assumes you know TypeScript and React.

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

React and React DOM must share the dispatcher that selects hook implementations during rendering. Next’s bundled files expect aliases that plain Node module loading does not supply. The [scoped DOM loader](../packages/parser/src/materialize/react-dom-modules.ts) applies those aliases without changing Node’s shared cache or resolver. It loads framework React DOM code, not application component bodies.

React creates the fibers, which are internal records for elements and components. Each fiber has a work tag that identifies its category. Bippy records the fiber tree after a commit, the stage when React applies an update to its rendering target. It stores the tree and capture metadata in a snapshot.

### Derive states from a symbolic model

One source component can describe alternative trees. The primary model must retain the conditions for those alternatives rather than store only a list of trees. Otherwise, separate expressions that depend on the same input can produce impossible combinations.

The parser represents these conditions with guards, which are Boolean formulas over unknown inputs. State enumeration constructs individual trees from this model. Both enumeration and comparison use guards to reject incompatible choices.

The state space is the set of trees that this model describes. A bounded list of states is a query result, not a replacement for the model.

## Analysis phases

[`StaticRenderer`](../packages/parser/src/render/static-renderer.ts) manages source preparation and model rendering. The comparison code then converts recorded fibers into a symbolic model and checks application captures against it.

The main operations are:

| Phase               | Implementation                                                                     | Result                                                            |
| ------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Project preparation | `createStaticRenderer` and `ModuleGraph` resolve configuration and source.         | The renderer can locate and parse the entry and its dependencies. |
| Model rendering     | `renderComponent` or `renderEntry` starts a fresh analysis and calls `finish`.     | React commits the model, and Bippy records its fibers.            |
| State analysis      | `enumerateStaticStates` reads the commits and constructs the symbolic state space. | The comparison code can query states, guards, and omissions.      |
| Verification        | `compareStaticToRuntime` and `replayEnumeratedStates` perform separate checks.     | Reports distinguish capture matches from replay evidence.         |

Evaluation and rendering are not separate passes over the entire application. The interpreter first determines the root element. React then renders component proxies, which ask the interpreter to evaluate more source and produce more elements.

The application capture follows a separate path. The application runs through its normal build and runtime while Bippy records its fibers. The model and application therefore use the same snapshot format but do not obtain their trees in the same way.

Before starting that application, the [corpus runner](../packages/parser/src/corpus/run-entry.ts) rejects an address that already has a listener. The check sends no page request and does not stop the existing service. Readiness probes have deadlines and reject responses after a recorded child exit. Another process can still bind the address during startup, so this does not prove server ownership.

## Module resolution and run state

The parsed project can outlive an individual analysis. Evaluated module values cannot, because a replay must not reuse mutations from an earlier run.

### Resolve the application's build tools

A macro is build-time code that rewrites application source. Its output can change imports and component names. Modeling a macro import as a library alias can therefore produce a different tree from the application.

For Create React App projects, the [macro transform](../packages/parser/src/graph/babel-macros.ts) loads `babel-plugin-macros` from the installed `babel-preset-react-app` dependency. It uses the Babel compiler owned by `react-scripts`. The [installed-module loader](../packages/parser/src/libraries/installed-modules.ts) follows that dependency chain rather than assuming the project has one shared copy of each tool.

The transform runs on the application's `src` files when the preset declares the macro plugin. Macro configuration and code execute as build infrastructure.

The parser temporarily removes DOM-only globals and supplies the development compile environment. It restores the process directory, environment and DOM globals afterward. It interprets the transformed application source instead of executing application bodies. This integration does not run the complete Create React App Babel preset.

Build configuration can read variables that a client bundle does not expose. The [corpus renderer](../packages/parser/src/corpus/render-entry.ts) uses the entry’s child-process environment during native configuration loading and later renders. It serializes these operations because `process.env` is shared, then restores the harness environment even after failure. Inherited `CI` and package-manager variables follow the [dev-server rules](../packages/parser/src/corpus/dev-server.ts).

The [environment reader](../packages/parser/src/corpus/process-environment.ts) retains declared variables without requiring a dotenv file list. Without that list, it marks the environment as partial and preserves uncertainty about unlisted variables. Client exposure also remains unknown when neither the manifest nor a recognized tool establishes a prefix. Node configuration can read declared private variables regardless of the client prefix.

The [Vite configuration loader](../packages/parser/src/graph/vite-asset-transform.ts) uses the command-line mode when it calls the exported configuration function. An explicit command-line mode overrides `config.mode` when Vite filters plugins and runs `configResolved`. Without that override, Vite calls the function in development mode and then applies the configuration’s mode.

Vite plugins can skip transforms when their project paths differ from the source resolver’s paths. For automatic TanStack Router splitting, a skipped transform omits the application’s `Lazy` component from the analyzed tree. [Configuration discovery](../packages/parser/src/graph/vite-config.ts) therefore resolves directory symlinks before loading Vite.

Vite reads `NODE_ENV` before loading configuration modules. The parser supplies the development default when this variable is absent or empty. It removes an unchanged temporary default before resolution, preserving Vite’s original presence check for dotenv handling. The parser does not replace explicit inherited values.

Native Vite resolution also establishes the client environment, even when no user plugins remain. The interpreter reads exposed dotenv values and custom prefix arrays from that resolved environment. It uses Vite’s resolved `DEV` and `PROD` flags rather than assuming a development build.

The interpreter creates a mutable `import.meta.env` object for each client module and each analysis run. It allocates the object during module initialization, so conditional writes use the existing heap journal. Its initial properties follow Vite’s sorted serialization order. Literal define values override resolved fields, while unevaluated define expressions remain unknown.

The [module recorder](../packages/parser/src/graph/module-record.ts) uses the same `NODE_ENV` string as the interpreter. Otherwise, CommonJS exports could select development code while expressions select production code. The native adapter rejects non-string or unevaluated `NODE_ENV` replacements because they cannot select these branches safely.

These rules do not establish complete build-environment parity. Remaining parity checks include:

- Vite projects without a discovered configuration file
- Server-side Vite environments and compiler-defined globals outside client environment fields
- Environment changes from shell scripts and build tools outside native Vite resolution
- Build tools that read the native system environment instead of `process.env`
- Cached configuration with environment-dependent side effects
- Configuration branches that depend on unlisted variables

[Package metadata](../packages/parser/src/graph/installed-package.ts) also distinguishes a wrapper's package version from its declared bundled engine version. Vite asset URLs and compiler selection use the engine version when the package supplies it. They must not treat Vite Plus version `0.3.1` as Vite version `0`.

A library model needs the component structure of the installed version. The [Emotion model](../packages/parser/src/libraries/emotion.ts) includes an `Insertion` component before styled content starting in Emotion 11.8. Earlier Emotion 11 releases render that content directly. The wrong structure can disagree with application fibers while its internal replay passes.

The [legacy Next image model](../packages/parser/src/frameworks/next-legacy-image.ts) also uses version-specific host structure. Next 10 and 11 use `div` wrappers; Next 12 uses `span` wrappers. Next 10.1 through 11.1.0 condition the `noscript` fallback on intersection visibility. The model retains both outputs when that visibility is unknown.

For Next 13.2, the [metadata adapter](../packages/parser/src/frameworks/next-metadata.ts) interprets installed metadata helpers instead of inventing tags. It passes interpreted layout and page exports through those helpers. Application bodies do not execute natively.

Metadata appears at the first router boundary, inside its template and loading boundary. A grouped root layout can put metadata outside the `body` subtree. Comparisons restricted to that subtree cannot check those metadata fibers.

The adapter leaves these inputs unknown:

- File-based metadata that requires the image loader
- Catch-all metadata parameters
- Parallel-route metadata collection

Other Next metadata APIs remain outside this contract. Successful initial renders do not prove streaming or error-recovery parity.

### Scope router inputs to each provider

A router’s basename is the URL prefix excluded from its route paths. The [React Router model](../packages/parser/src/frameworks/react-router.ts) removes that prefix before matching routes. A nonmatching known prefix renders no router children. The link models use the same local pathname and basename.

For a fixed analyzed URL, the model stores one location object per mounted router instance. A change in the normalized basename replaces that object. Returning to an earlier prefix does not restore its old object. An unchanged basename preserves identity, so unrelated parent updates do not invalidate memoized location consumers.

An unknown basename does not justify an empty tree. `useHref` resolves static paths that start with one `/` and contain no `..` segment. Other target forms stay unknown. These checks cover browser routing, not complete navigation or hash and memory histories.

### Resolve declarations without executing modules

The [source parser](../packages/parser/src/parse/parse-source-file.ts) uses `oxc-parser` to build an abstract syntax tree. This tree describes source expressions and statements. `SourceFileCache` reuses parsed files and checks file metadata for changes.

The [module graph](../packages/parser/src/graph/module-graph.ts) records declarations and module dependencies. Its resolver uses `oxc-resolver` with package conditions and project paths to locate dependencies. The graph follows exports across modules and reports missing or ambiguous exports.

An explicitly analyzed framework module also enables its relative source dependencies. Bare package imports retain their existing policy unless the adapter explicitly selects another module.

Resolving an export identifies its declaration. The interpreter evaluates that declaration when analysis needs its value. This separates the reusable source representation from values that can change during a render.

During module initialization, property-read initializers run in statement order. Deferring those reads could capture a later mutation instead of the initial value.

A dependency can remain external to source analysis. The interpreter can use an external-value model or preserve uncertainty about the dependency. Options control which external packages the parser analyzes from source.

### Reuse the project, not evaluated state

`StaticRenderer.derive` creates a renderer that shares the parsed project with its parent. Each render still calls `startRun`, which creates a fresh interpreter and document environment. This avoids reparsing the project for every replay without sharing evaluated application state.

A [scope](../packages/parser/src/evaluate/scope.ts) maps names to interpreted values and refers to a parent scope. Looking up a name searches the current scope and then its parents. Function values retain their source body and scope, so the interpreter can evaluate closures.

A result can also depend on captured observations, such as configuration or store state. Those observations are inputs to the analysis. A tree that matches under those inputs does not establish a match for every possible response or store value.

## Conditional evaluation

The [interpreter](../packages/parser/src/evaluate/interpreter.ts) evaluates source with `StaticValue` records. A record can describe an exact value or alternative values, including values within objects and collections. When the model cannot determine a value, it records uncertainty and a reason.

### Preserve relationships between expressions

A branch value records alternatives for an unresolved condition. The [predicate model](../packages/parser/src/evaluate/predicates.ts) relates those alternatives to symbolic inputs. A symbolic input represents data whose value the analysis does not know.

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

### Restore mutations between alternatives

Evaluating both sides of a condition can change shared state. If the interpreter retains mutations from the first side, the second side starts with the wrong values. This can produce a tree that neither path produces in the application.

[`HeapJournal`](../packages/parser/src/evaluate/heap-journal.ts) records conditional changes to shared interpreted state. At the end of a path, it saves the changed values and restores the previous values. After evaluation of the alternatives, it combines their results under the branch conditions.

The journal distinguishes preexisting objects from objects allocated within a path. An object allocated inside one alternative does not need restoration for another alternative that cannot reference it. Pending hook updates also require this distinction because an update must remain conditional on the path that schedules it.

Conditional reads require the same guards as writes. The interpreter narrows a value when the active conditions identify a compatible subset of its alternatives. Journaling writes alone would still permit a callback to read a value from an incompatible path.

### Preserve identity as well as conditions

Two equal-looking objects need not be the same object. Two references to the same function must retain that identity. The [value implementation](../packages/parser/src/evaluate/values.ts) therefore records allocation identity separately from symbolic conditions.

Timer handles retain resource identity even when their numeric ranges match. The queue uses that identity for cancellation after the interpreter copies a value.

Component identity has the same requirement. Creating a wrapper component twice can create two component types, even when both wrappers use the same source body. The materializer uses source closure identity rather than component names alone to identify component proxies.

React can mount the same element object in two positions. Those positions have separate component instances. The materializer distinguishes repeated element occurrences within each decision scope when it caches their React elements.

Equal props do not establish a repeated render input. A nested provider can change the context while the component calls itself with unchanged props. The recursion check therefore compares the ancestor’s recorded context reads as well as its closure and props.

Context comparisons preserve object identity rather than comparing object fields. Recursion probes do not become application context dependencies, because that could invalidate an unrelated memoized child.

These checks still cannot prove that recursion never terminates. A cutoff produces an unknown subtree, and the configured depth limit still applies.

## Rendering with React

The [materializer](../packages/parser/src/materialize/materializer.ts) converts interpreted values into real React elements. Each source component becomes a proxy component whose render calls the interpreter. The proxy never calls the application function itself.

### Represent uncertainty in the fiber tree

React requires elements to render, so an unknown value cannot remain only an interpreter record. The materializer converts uncertain structures into [marker components](../packages/parser/src/materialize/markers.ts). Their fibers record where the uncertainty occurs:

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

The proxy therefore retains the interpreted thrown value while React locates the boundary. The [class renderer](../packages/parser/src/evaluate/class-component.ts) passes that value to `getDerivedStateFromError`, preserving primitive values and object identity.

When every branch throws, [caught-value extraction](../packages/parser/src/evaluate/thrown.ts) maps the payloads without creating a new decision. Otherwise, the model could pair an error with the condition that selects a different error.

The current class model does not invoke `componentDidCatch`. Mixed throwing and nonthrowing paths still need cause-preserving validation.

### Coordinate hooks with React commits

Each stateful proxy has a `HookFrame`, which stores interpreted hook state. The proxy also uses real React hooks to request another render and schedule effect processing. This lets React control when the proxy renders while the interpreter controls the values that application hooks observe.

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

[`CommitCauses`](../packages/parser/src/materialize/commit-causes.ts) records the conditions under which modeled updates occur. Nested causes require both conditions. Independent causes that each suffice for an update permit either condition.

Effects and ref callbacks use conditional mutation evaluation, so their writes retain those causes. The render result associates the resulting commit causes with its recorded trees. The state analysis can then reject a later tree whose cause conflicts with the selected inputs.

### Bind deferred work to its scheduling conditions

A deferred callback can run after an unrelated commit. Using conditions from that commit would associate the callback with the wrong inputs. Modeled tasks instead retain the conditions that applied when analysis scheduled them.

The [timer queue](../packages/parser/src/evaluate/timers.ts) also records cancellation as journaled state. The same state keeps timers inactive on paths that never schedule them. If a conditional child cancels a shared timer, the timer remains active on paths without that child. Callback execution uses both the scheduling and cancellation conditions. Cancellation through a conditional handle uses the selection condition for each handle.

Direct `queueMicrotask` calls use the same activation checks without exposing a cancellation handle to application code. The queue records activation when it enqueues work, not when the interpreter allocates a handle. Cancellation does not count as an update when the queue has no record of the handle.

[Promise reactions](../packages/parser/src/evaluate/promises.ts) record activation when a handler subscribes, even if the promise is still pending. A reaction uses both its registration condition and its settlement condition. Journaled promise state keeps settlement on one path from changing another path. `Promise.all` records each input reaction's completion separately instead of sharing a counter across paths.

Task callbacks also journal their writes under the full execution condition. This matters when a conditional component schedules a callback that later changes a shared store. Checking that the callback can run is not enough to restrict its writes.

A promise that adopts another promise enters a following state. Later resolver calls cannot replace that state. Adoption jobs and `finally` continuations run through the microtask queue. Self-resolution rejects with a `TypeError`.

A modeled leading `await` resumes in a reaction microtask even when its operand is a primitive or a settled promise. It does not drain unrelated microtasks while evaluating the operand. An exception thrown before reaching the await remains synchronous; a rejected promise resumes the catch block through the reaction queue.

Promise support remains incomplete. Thenable behavior, custom promise constructors, escaped or widened outcomes, non-leading await expressions, and render-local suspension still require verification.

[Mounting](../packages/parser/src/materialize/mount.ts) runs React updates and modeled tasks within a bounded settlement period. It records committed trees before it unmounts the root and removes instrumentation. Reaching the settlement limit does not prove that the application has no further updates.

## Symbolic states

The [pattern reader](../packages/parser/src/harness/static-pattern.ts) converts recorded fibers into comparison patterns. A pattern describes known fibers and uncertain regions. Marker fibers become branch, repeat, opaque, or wildcard pattern nodes.

An opaque node represents a component with an unmodeled body. A wildcard permits structure that the analysis cannot determine. Neither node establishes the exact structure of the region that it represents.

### Keep commits and causes together

The [symbolic tree](../packages/parser/src/harness/symbolic-tree.ts) stores symbolic inputs and guarded commit patterns. Each commit has a tree and a guard. A guard restricts when that committed tree can occur in the model.

Commit guards matter even when two commits have the same visible tree. Combining identical patterns must retain the conditions that permit either occurrence. Otherwise, deduplication changes which inputs appear to produce the tree.

### Enumerate related decisions together

The [state-space implementation](../packages/parser/src/harness/state-space.ts) groups decisions that share inputs. A guard solver checks whether their conditions permit a common assignment of values. Independent groups do not require immediate enumeration of every combined state.

For two independent Boolean inputs, each group has two local assignments. The full combination has four assignments. Grouping lets the model retain the local choices without constructing all four trees before a query needs them.

The implementation constructs complete state patterns on demand, within a state budget. It records omitted alternatives and repeat counts instead of treating the enumerated list as exhaustive. A state with all branch decisions selected can still contain opaque nodes or wildcards.

## Comparison and replay

Application comparison and replay check different properties of the model. Application comparison asks whether a capture matches a modeled state. Replay asks whether a combined analysis agrees with separate analyses under selected decisions.

### Match an application capture

[`compareStaticToRuntime`](../packages/parser/src/harness/compare-render.ts) checks whether an application tree matches the symbolic model. This test is membership checking. It can search the symbolic tree without requiring the matching state in the initial enumerated list.

The comparison checks fiber structure. It also compares these recorded fields:

- Component names
- Work tags
- Element keys
- Text nodes

Opaque nodes and wildcards permit broader matches, which the report distinguishes from exact matches. Such a match does not validate the full contents of the uncertain region.

A framework profile identifies framework fibers to ignore or treat as transparent during comparison. This accounts for framework structure without requiring the model to reproduce every runtime wrapper. These rules must not conceal differences in application components.

An `exact` membership result applies to the captured state and the comparison rules. It does not prove that every modeled state is reachable. Fiber coverage measures recorded fibers, while guard coverage reports which alternatives the captures demonstrate.

### Render selected decisions again

[`replayEnumeratedStates`](../packages/parser/src/harness/state-replay.ts) creates a fresh interpreter and materializer for each sampled decision assignment. A pinned decision selects one branch alternative or repeat count instead of rendering all alternatives together. This can expose shared-state interference that the combined render failed to prevent.

The materializer records selected input guards for task checks. It does not use these assumptions to narrow ordinary render values. That narrowing can remove branch markers and cause React to remount their children. Iteration-local inputs and synthetic choices do not become global task assumptions.

Replay uses the same interpreter implementation. It is not an independent execution of application source. A model error that affects both the combined render and the replay can remain undetected.

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

The current renderer uses React DOM and the happy-dom implementation of the Document Object Model. The [runtime loader](../packages/parser/src/materialize/react-runtime.ts) resolves application React packages or framework-specific replacements. It can use the analysis package versions when application packages are unavailable or lack the required support.

The runtime uses its React module’s `act` or `unstable_act` export when available. A Bippy-recorded hook probe checks runtime compatibility. Failed probes release their recorder and restore console output before fallback.

A host model defines available platform names and modeled behavior. Host declarations for React Native do not establish native renderer support. Fiber-only comparison also misses scalar host text that React stores without a separate text fiber.

[Framework adapters](../packages/parser/README.md#frameworks-srcframeworks) select roots and compose framework-specific trees. With server component support enabled, the interpreter evaluates server bodies without client fiber boundaries. Client components retain their fiber boundaries.

The guard model supports selected comparisons, not every JavaScript constraint. Expression limits can discard condition detail, and evaluation limits can produce unknown values. A solver result applies to the represented conditions, not to every behavior of the original program.

Task registration and captured lexical variables still require further isolation checks. Lifecycle scheduling also needs further verification. Partial replay comparison does not establish every commit order or unresolved cause. The [execution plan](../scratchpad.md#7-workstream-p1-effect-cause-guards-and-reachable-commits) records these gaps.

The [witness planner](../packages/parser/src/harness/witness-plan.ts) proposes input assignments for guard alternatives without runtime evidence. A runtime witness is an application capture that demonstrates an alternative. The planner does not execute browser actions or establish coverage of event sequences.

The parser has not established that every modeled state is reachable or that every reachable state appears in the model. Interpret membership results alongside replay verification and any reported omissions. The [state-model design](../packages/parser/docs/exhaustive-states.md) describes the intended guarantees. The [documentation plan](../scratchpad.md#architecture-documentation-plan) records the scope of this page.
