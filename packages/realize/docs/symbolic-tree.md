# Symbolic tree

Reads a React project with the TypeScript 7 checker and prints, for each component, a Mermaid flowchart of everything it can render and a Mermaid state diagram of its states and transitions. It never runs the code.

## Run

```sh
pnpm analyze tests/fixtures/symbolic-tree/tsconfig.json              # every component
pnpm analyze tests/fixtures/symbolic-tree/tsconfig.json -c Wizard    # one component
pnpm analyze path/to/app/tsconfig.json -f features/ --json
```

Run these from `packages/realize`.

The output is two Mermaid diagrams per component, which GitHub and most markdown viewers render when they are pasted into `mermaid` code blocks.

The first is a `flowchart` of the render tree: every element the component can render, with a diamond at each branch and its `✓` and `✗` arms below it, a double-bordered box for each list, and a dashed pill for what each handler and effect does to state, like `onClick ⇒ step = "details"`. An expression the analyzer couldn't evaluate is shown as written, marked `⚠`.

The second is a `stateDiagram-v2`. Each state is labelled with the conditions that select it and what it renders, each transition with the button text, the handler or the effect that causes it, and `[*]` points at the state the component first renders when its initial state values decide that. A condition shows only what decides the state, so the branch `step !== 0 ∧ step !== 1 ∧ step === 2` reads `step === 2`. A handler that leads from every state in a region to every other is drawn once, as a `from any state` box with an arrow to each state. A component with several independent regions draws them as concurrent regions, and a region with more states than are drawn ends in a `more` state that the hidden transitions lead to. Unreachable branches, warnings and bailouts are listed in their own boxes. The counts go to stderr. With `--json`, the full analysis is printed instead. Run `--help` for all options.

| Option                       | Effect                                                   |
| ---------------------------- | -------------------------------------------------------- |
| `-c, --component <names...>` | Show only these components                               |
| `-f, --file <filter>`        | List states only for files whose path contains this text |
| `-d, --depth <n>`            | Cut the render tree off at this depth (default: 12)      |
| `-s, --states <n>`           | Draw at most this many states per region (default: 32)   |
| `--json`                     | Print the analyses as JSON instead                       |

Labels use a few symbols:

- `∧` joins the conditions a state needs, `∉ {…}` a place that is none of these values
- `◆` a branch another region decides, `↻` a list
- `⚠` an expression the analyzer couldn't evaluate, shown as written
- `· ∅` the state renders nothing

## What it does

The pipeline runs the React Compiler's own front end, then our passes. Read `src/core` in this order:

| File                              | Stage                                                                            |
| --------------------------------- | -------------------------------------------------------------------------------- |
| `analyze-project.ts`              | Opens the TS project, compiles each file, runs each component, then lists states |
| `compile.ts`                      | Runs the React Compiler on a file and keeps each function's HIR                  |
| `analyze-component.ts`            | Runs our passes on one component's HIR                                           |
| `type-provider.ts`                | Types the compiler's HIR from the TS checker                                     |
| `interpret.ts`                    | Runs the HIR symbolically: the render tree, with every branch kept               |
| `control-flow-walker.ts`          | Walks the HIR blocks: branches, switches, loops, phis and catch handlers         |
| `destructurer.ts`                 | Binds what a destructuring takes from props, a hook result or a literal          |
| `mutation-tracker.ts`             | Which mutations in an instruction touch props, state or a literal being built    |
| `utils/get-mutated-parameters.ts` | Which parameters a function writes into                                          |
| `callback-passer.ts`              | Callbacks handed to effects, promises and calls the analysis can't see into      |
| `array-iteration.ts`              | Rows mapped from an array and callbacks run per item                             |
| `claim-recorder.ts`               | Records a cast, a non-null assertion or an invariant call where it is made       |
| `pattern-matcher.ts`              | Turns a ts-pattern match chain into branches on its subject                      |
| `walk-state.ts`                   | The guards and async flag a walk carries                                         |
| `binding-table.ts`                | The interpreter's bindings, one per declaration, and each place's domain         |
| `function-registry.ts`            | Functions values refer to, the file each came from, and closure captures         |
| `external-sources.ts`             | Hooks, contexts and stores: values that change from outside                      |
| `effect-collector.ts`             | The updates and mutations one handler or effect makes                            |
| `build-jsx.ts`                    | The element each JSX tag renders                                                 |
| `diagnostics.ts`                  | Bailouts and warnings, each reported once                                        |
| `symbolic-values.ts`              | Builds and folds the values the interpreter produces                             |
| `control-flow.ts`                 | Branch outcomes and the conditionals they merge into                             |
| `source-file-resolver.ts`         | Reads types, names and source text at a compiler location                        |
| `domains.ts`                      | Turns a TS type into the values it can take, and tests membership in them        |
| `type-samples.ts`                 | Turns a TS type into sample values to mount props with                           |
| `infer-props.ts`                  | Samples untyped props from what they read and what callers pass                  |
| `link-components.ts`              | Records what each parent passes to each child it renders                         |
| `value-domains.ts`                | Turns a parent-side value into the finite set of values it can take              |
| `instance-states.ts`              | Lists a child's states again with its props narrowed to one parent's values      |
| `claims.ts`                       | Checks render, handler and state-domain claims in every state where they run     |
| `field-cases.ts`                  | Reads the literal values an update or initial value can take                     |
| `reachable-ranges.ts`             | The numeric range a state can reach through its updates                          |
| `module-values.ts`                | Module constants, and the module variables a file writes                         |
| `context-setter-fields.ts`        | Which context fields set which state, across the providers that supply them      |
| `store-actions.ts`                | What each zustand store action sets                                              |
| `string-samples.ts`               | Strings a component may parse, picked by name                                    |
| `collect-handlers.ts`             | What each event handler and effect updates                                       |
| `regions.ts`                      | Groups branches that test the same data into regions                             |
| `enumerate-states.ts`             | Lists each region's states and transitions                                       |
| `reachable-constraints.ts`        | The values every binding can reach, from its initial value and every update      |
| `state-enumerator.ts`             | Walks the render tree under a region's constraints and lists its alternatives    |
| `transitions.ts`                  | Which states a handler's updates lead to, with its update sequences cached       |
| `unreachable-branches.ts`         | Reports branch sides no state reaches                                            |
| `constraints.ts`                  | What a path assumes: possible values, branch outcomes, numeric bounds            |
| `format.ts`, `serialize.ts`       | Printing and JSON output                                                         |
| `types.ts`                        | The data passed between stages                                                   |
| `utils/`                          | One helper per file: places, keys, HIR, predicates, truthiness, traversal, TS    |

The browser verifier lives in `tests/conformance/verifier`, next to the repos it runs on.

1. Loads the project with `typescript/unstable/sync` (TypeScript 7).
2. Parses each file with Babel and runs the React Compiler on it in `infer` mode, so it finds components by the compiler's own rules: a capitalized function that returns JSX or calls a hook, or one wrapped in `memo` or `forwardRef`.
3. Keeps each component's HIR right after `inferReactivePlaces` and stops the compiler there. A function the compiler can't lower becomes a `compiler-error` bailout. The patch also lowers any default value, like `icon = <Icon />` or `label = theme.closeLabel`, and any `case` test, which the compiler refuses when it can't prove reordering them is unobservable. The analysis doesn't reorder anything. The compiler's check for libraries it won't memoize, like react-hook-form's `watch` or TanStack Table, is turned off, since the analysis doesn't memoize; the compiler's own types for those modules are kept.
4. Types the HIR with the compiler's `inferTypes`, backed by the checker through our patch:
   - React hooks and APIs resolve through the checker, which follows aliases and re-exports to React's declarations.
   - Values the compiler leaves untyped take their TypeScript type: primitives, arrays, `Map`, `Set`, readonly collections and function signatures. A second round lets methods like `items.push` resolve to the compiler's own signatures once `items` is known to be an array.
   - A collection method the compiler doesn't list mutates its receiver when `lib.d.ts` declares it on `Array` but not `ReadonlyArray`, and likewise for `Map` and `Set`.
5. Evaluates the HIR symbolically. Each value becomes an expression over bindings:
   - props, typed from the parameter
   - `useState`, `useReducer` and `useContext`
   - the project's own custom hooks, run inline as part of the component, across files, so their state is the component's state and the functions they return are known
   - zustand stores: every selector of one store reads a field of one value
   - other hooks, typed from their return type
   - `.map` items, including a `.map` reached through an optional chain like `data?.rows.map(…)`, and the rows of `Array.from(arrayLike, callback)`. A binding that stays untyped is an `untyped-item`, `untyped-prop` or similar bailout only when the render, a handler or a claim reads it; the unused `_` of `[...Array(n)].map((_, index) => …)` is not
   - calls it can't see into whose return type has finite values, like `hasPermission()` returning `boolean`
   - `useRef`: the first render reads the value passed to `useRef`, unless the render itself writes the ref. A handler's write to `ref.current` shows on the next render.
   - module variables the file writes, like `let clicks = 0` with `clicks++` in a handler: the first render reads the declared literal, and any render after a handler may see a new value, since other code can write them too.
   - pure calls on values with a few known cases fold over those cases: `Math.max`, `Math.floor` and the other pure `Math` methods, `Number`, `String`, `parseInt`, `parseFloat`, and `includes` or `indexOf` on a literal list. So does arithmetic on known values. `every`, `some`, `find`, `findIndex` and `filter` over state with a literal initial array run the callback over those items for the first render.
   - values a loop carries, like a flag a `for` body sets, typed as declared. The body runs once with them, so the setters and pushes inside it count, and a value a `break` leaves with is kept.
   - a `push` or property store on a local array or object, applied as is when it always runs. One that may not run, or runs in a loop, widens the value to cover both.
6. Where control flow merges, the value becomes a `Conditional` that records which terminal decided it. Early returns, `?:`, `&&`, `||`, `??`, `?.` and `switch` all produce one. A `?:`, `&&`, `||`, `??` or `?.` merges where it ends, so a `?.` in a `className` doesn't split the rest of the render. Member reads past a `?.`, and reads of a value that may be `undefined`, are assumed not to throw. The compiler lowers every `&&`, `||` and `??` to a branch whose first arm is the left value; for `&&` that arm is taken when the left side is falsy, so the right side of `a && f()` runs under the guard `a`. A test whose outcome is known decides its branch on the spot: comparisons of two literals, and comparisons of an object, array, function or element with a literal, which `===` never equates and `==` never equates with `null` or `undefined`. So a defaulted option like `{ required = true }` called with `{ required: false }` takes only the branch the caller picked.
7. Turns each binding's type into its possible values. Unions split into cases, and `any` becomes `Unknown`. For plain JS, literal values at call sites stand in for prop types. A type isn't trusted where it can't hold: A module constant, an imported one, or a member of one whose type is a single literal, like `SIZES.small` of an `as const` object or an enum member, reads as that literal, so `case SIZES.small:` compares with `"sm"`.
   - a read through an index signature, like `envKeyMap["azure"]` of a `Record` or `items[0]`, may be `undefined`
   - without `strictNullChecks`, an optional property and a call's result may be `undefined`, which their types leave out
   - a `useState()` with no initial value is typed `undefined`, though a handler may set it to anything
8. Collects handlers from event handlers and effects, and from code that may call the component's functions later:

   - setters and functions passed to child components under any prop name, including render props, function children and components declared inside the component, along with the handlers in the JSX they return, and JSX passed in any prop
   - a function passed as `action` on a `<form>`, or as `formAction` on a `<button>` or `<input>`, which React 19 runs on submit with the form data, and the action a `useActionState` returns, which runs its function like a reducer over the previous state and the form data, with `isPending` typed as a boolean
   - functions passed to hooks and calls it can't see into, directly or in an options object, like `useMutation({ onSuccess })`, and functions stored on objects, like `recognition.onresult`, which run as effects with unknown arguments. When such a call's result is itself passed as an event handler, like `onSubmit={form.handleSubmit(onSubmit)}`, the functions it received run as that element's handler instead
   - ref callbacks, which run when React attaches the element
   - `createPortal(children, container)` renders its children in place

   What each handler does:

   - `setX(...)`, `setX(prev => ...)`, and `dispatch(action)` evaluated through the reducer
   - calls to local and module functions are followed, and a call to a function a condition chooses, like `isDocument ? setDraggedDocument : setDraggedFolder`, may be either
   - a helper that returns JSX, like `getFileIcon(path)`, is followed into whichever file of the project declares it, so its branches become the component's
   - a ts-pattern `match(subject)` chain: each `.with(pattern, handler)` is a branch, a literal pattern tests `subject === literal`, `true` and `false` test the subject's truthiness, an object pattern tests each field, and `P.*` or `.when()` patterns are unknown tests; `.otherwise(handler)` is the final else and the last arm of `.exhaustive()` is unconditional. `Boolean(x)` is read as `!!x`, so `match(Boolean(user)).with(true, () => user!.name)` narrows `user` in that arm
   - a handler or callback runs with an unknown value for every parameter, since React or the component that calls it decides what it passes. A missing argument is `undefined` only in calls the analyzed code makes itself, so `onChange={(event, checked) => setChecked(checked)}` keeps `checked` open rather than setting the state to `undefined`
   - `catch` blocks run too, as what a handler tries may throw. Each `await` in the `try` body may throw, so the catch runs from each one under its own unknown `throws` guard, and the rest of the body runs under its negation. A failed upload sets its error without reaching the `setStep("done")` after the await. Catch updates are async when the body awaited, since a rejected promise lands there later. A body with no `await` runs the catch once, after the whole body. A `finally` the compiler copies into both paths follows the same order
   - code after `await` or inside `.then` makes the new value `Unknown(async)`
   - a setter a context's providers pair with a field, like `setOpen` with `open` in `value={{ open, setOpen }}`, sets that field when a consumer calls it. It may not happen, since a consumer can render without its provider.
   - a zustand store's action sets the fields its `set` call assigns, from its arguments, literals or the previous state. `useStore.getState().action()` runs the same action, and `useStore.setState(objectOrUpdater)` merges into the state. An action the summary can't model sets the store to unknown. Later updates in the same handler build on earlier ones.
   - a function or setter kept in state, in `ref.current` or in a module variable runs when a handler calls it or passes it as a handler. When several may be stored, exactly one runs.
   - a change event on a controlled checkbox reads `target.checked` as the opposite of `checked`. A radio fires only when unchecked and reads `true`. Both read `target.value` from the `value` attribute. A `select` reads one of its option values.
   - calling into any other hook's result or context value, like `query.fetchNextPage()`, may change it, and every hook from the same module, like `useSelector` after a Redux `dispatch`, to anything, later
   - a built-in array or string method that changes nothing, like `items.find()` or `query.trim()`, leaves the value it's called on as it is, as its type shows
   - state the compiler's effects prove a handler mutates is forgotten, since React shows the new contents on the next render. State it passes to a function that may mutate it, like a library's `remove(items, item)`, is forgotten too, without a warning. When the handler may not re-render, like `items.push(x)` alone or `setItems(items)` with the same array, the mutation stays pending and the next render from any other handler reveals it.

9. Lists the states:
   - It splits the render's branches into regions first. Two branches share a region when their tests read overlapping places, like `toast` and `toast.cancel`, or when one sits inside the other's branch. Regions vary independently, so each is listed on its own and the screens are every combination of one state per region.
   - Within a region it splits only on branches in the render output, and narrows each value as it goes. A truthy `x?.y` also proves `x` isn't null. Assuming `a || b`, `a && b` or any `?:` test narrows each value to what either side allows, by assuming the test both ways and joining the two results: once `kind === "fab" || kind === "extendedFab"` holds, `kind` is one of those two.
   - What it learns about a value is keyed by the value's structure and bindings, not its printed text. Two calls to one helper that print the same stay separate.
   - A difference-bound solver handles `<`, `<=` and `===` on numbers and `.length`. A `.filter()` or `.slice()` result is no longer than the array it's called on, and `.toSorted()`, `.toReversed()` and `.with()` keep its length.
   - The fields of a value typed as a union of objects vary together. Once `query.isPending` is false, `query.isError` and `query.data` take only what the remaining members of React Query's result give them. A field's values come from every member, even where TypeScript narrowed the read.
   - State values are limited to the initial value plus every value a handler can set. A state initialized from an untyped value cast to a type, like `useState(cell.getValue() as boolean)`, can hold anything, since the cast only asserts the type.
10. For each state and each handler that changes its region, finds which states of the region can come next. A handler that doesn't touch a region leaves it as it is. It also reports branches that can never render. A branch whose value renders only under a test it wasn't computed under, like a ternary kept in a variable and shown behind `&&`, still runs without that test, so it is never reported.
11. Links parents to children. For every `<Child prop={…}>` in a parent's render whose component is in the project, it records what the parent passes under each prop name: a literal, the possible values of a parent binding, both arms of a conditional, `true` and `false` for a negation or comparison, and `object`, `array`, `element` or `function` for the rest. Where that gives a finite set and the element has no spread, it lists the child's states again with those props narrowed to it, as an instance of the child under that parent. An instance narrows only the props the child branches on, or leaves untyped; a `className` or a count the child only prints does not make a new one. Links that pass the same values to the same child share one instance, so a button used in two hundred places with three variants is enumerated three times, not two hundred, and an instance whose narrowing changes none of the child's states, unreachable branches or claim verdicts points at the child's own report. The child's own report stays as its types allow, so other callers are still covered.
12. Checks the claims the code makes. A claim is something the author asserts that TypeScript takes on faith: `x as T` where `T` leaves out values `x` may hold, `x!`, `invariant(cond)` or `assert(cond)`, and the type argument of a `useState` or `useReducer`. Each is checked in every state where its code runs: a claim inside a handler only in the states that render that handler's element, under that state's conditions and with the `if` guards on the way to the claim assumed true, so `if (!next) return; setStatus(next as Status)` is judged with `next` truthy. The same goes for a typed state: each update is checked in the states that render its handler, with its guards assumed, and a conditional value is split by the solver, so `if (next) setStatus(next)` with `next: Status | undefined` holds. A value whose type only may equal a case, like a `string` or `{}` cast to `"idle" | "saving"`, leaves the claim unproven rather than broken. Without `strictNullChecks`, TypeScript leaves `null` and `undefined` out of every type while letting every type hold them, so a cast or a typed state also accepts `null` and `undefined` there. A cast's subject is evaluated like an update, so `(isTall ? orientation : null) as Orientation` is checked on each side of the condition. An update of the form `x ?? fallback` drops the nullish values of `x`. A claim inside a callback handed to a call the analysis can't see into, like a `match(...).with(true, () => user!.name)` branch, has no state of its own, so it is checked against every reachable value and is at most unproven. A cast to literals or a typed state is a membership test against the possible values; a non-null assertion or an invariant is a condition evaluated with the same solver as the branches. The verdict is `holds` when every state proves it, `broken` when some state refutes it, with the state and the shortest path of actions from the first render, and `unproven` when a state leaves it open, with the values that would break it, like `mode = "edit", user = null`. Whether a cast or a `!` makes a claim is judged by the type TypeScript gives the value, not by the `undefined` the analysis adds to an indexed read in case the index is out of range, so `options[index] as Option` claims nothing unless `noUncheckedIndexedAccess` puts `undefined` in the type. A claim whose values are opaque, such as `ref.current!`, is not recorded. The verifier does not check claims yet.
13. Reports warnings from the compiler's mutation effects:

| Warning           | When                                                                                                                   |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `lost-update`     | A handler mutates state, then sets it to the same array or object. React skips it.                                     |
| `state-mutation`  | A handler mutates state in place, before copying it or without setting it.                                             |
| `render-mutation` | State is mutated during render.                                                                                        |
| `prop-mutation`   | A prop is mutated, like `items.sort()` on an array prop. A ref prop written through `.current` or a helper is not one. |

A call to a function the project declares counts as a mutation of each argument the function writes into, directly or through a local it loads, stores or destructures the parameter into. `setCardData(items, cardOptions)` where `setCardData` sets `options.shape` mutates the `cardOptions` prop. A call the analysis can't see into, like a library's, is not counted, since the compiler only says it might mutate.

## The React Compiler source

`src/react-compiler` is `babel-plugin-react-compiler`'s source, generated by `pnpm build` and not committed. The build fetches the facebook/react revision that `patches/react-compiler.patch` names and applies the patch, much as react-doctor builds oxc. The patch is the only code of ours in there. It adds a `typeProvider` option that types values from the TypeScript checker, in `Environment.ts` and `InferTypes.ts`, and it lowers three statements the compiler otherwise rejects, in `BuildHIR.ts`: a `finally` clause (run on each way out of its try, unless a `break` or `continue` leaves the try), a `throw` inside a `try` (an edge to its handler), and a dynamic `import()` (an opaque value). It also keeps a non-null assertion `x!` as a `TypeCastExpression` of kind `non-null`, which the compiler otherwise drops, so the analyzer can check it.

- To change the compiler, edit `src/react-compiler` and run `pnpm build --save` to write the patch.
- To move to a newer compiler, run `pnpm build --upgrade <revision>`. It reapplies the patch with a three-way merge and leaves conflict markers where a hunk no longer fits.

## Example

`tests/fixtures/symbolic-tree/src/reducer.tsx`:

```mermaid
---
title: Wizard src/reducer.tsx:21
---
stateDiagram-v2
  direction LR
  S1: state.step === "done" · #lt;p#gt; "Thanks!"
  S2: state.step !== "done" ∧ state.step === "details" · #lt;form#gt; #lt;input#gt; #lt;button#gt; "Next"
  S3: state.step !== "done" ∧ state.step !== "details" · #lt;form#gt; #lt;input#gt; #lt;button#gt; "Back" #lt;button#gt; "Next"
  [*] --> S2
  S2 --> S3: "Next"
  S3 --> S2: "Back"
  S3 --> S1: "Next"
  state "unreachable branches" as unreachable {
    unreachable1: never state.hasError L26
  }
```

The error alert can never show, because nothing dispatches `fail`.

## Known gaps

- **Context values come from their type.** A provider's setters are paired with the fields they set, and zustand actions with the fields they assign. Other values keep their declared type, since a component may render under any provider and the verifier mounts it with any value the type allows.
- **Linking stops at one level and at finite values.** An instance narrows a child's props to what one parent can pass, but the parent's own props are taken as their types allow, so a value handed down two levels is only as precise as the middle component's type. An object or array prop stays opaque, and a prop a spread may set is not narrowed. The verifier still mounts each component on its own with any props its type allows, so instances are not verified yet.
- **Library calls are opaque.** Their code isn't in the project, so a call's result is known only from its return type and, for array methods, its length.
- **Loops run once.** A value a loop carries can take any value its type allows after the loop, even when every iteration sets the same one.
- **Class components are reported, not analyzed.** The React Compiler finds and lowers only function components and hooks, so a class has no HIR to interpret. Each one gets a `class-component` bailout.
