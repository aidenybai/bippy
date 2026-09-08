# Exhaustive reachable states

The static render used to answer "what does this tree look like?" with one tree
whose uncertain spots were inline maybe-nodes (`$Branch` rendering a preferred
alternative, `$Repeat` absorbing any count). That is one state with hedges, not
the set of states the source can reach. The harness now enumerates that set and
checks the runtime capture for membership in it.

## Representation (`src/harness/state-space.ts`)

```ts
interface StaticState {
  tree: PatternNode[]; // concrete: no branch or repeat nodes remain
  conditions: StateCondition[]; // the decisions that select this tree
}

interface StaticStateSpace {
  states: StaticState[];
  budget: StateSpaceBudget; // { maxStates, maxRepeat }
  omitted: OmittedStateSpace | null; // non-null whenever `states` is incomplete
  commits: PatternNode[][]; // distinct committed patterns, in commit order
}
```

A condition is one of:

- `branch` — predicate variable, reason, source location, chosen alternative
  index out of how many;
- `state-update` — the same, for a branch whose predicate is a `useState` /
  `useReducer` cell (`state(<cell>)`);
- `repeat` — repeat variable, source location, concrete cardinality;
- `transition` — which committed tree (of how many) this state is. Effect and
  timer driven re-renders commit new trees; each distinct committed tree is a
  state of its own, reachable within the settle window.

Environment assumptions (`window.innerWidth`, env vars, host values) surface as
`branch` conditions whose reason names the host value; the interpreter has no
way to pick a side, so both are states.

`tree` is a `PatternNode[]` rather than a `RuntimeSnapshot` because a concrete
state can still contain `opaque` subtrees (an external component whose render
is not modeled) and wildcards; a `RuntimeSnapshot` cannot express "one subtree
of unknown shape here". After enumeration a state's tree contains no decision
nodes, so matching it is a plain structural diff with those two kinds of hole.

## How states are produced

The interpreter runs once and the materializer renders once. Every branch
alternative is rendered by React under a `$Branch`/`$Alternative` marker and
every repeat body under a `$Repeat` marker, so the single committed tree is the
product of all alternatives. `enumerateStateSpace` then projects that tree onto
each assignment of the decision variables; this is the "materialize once per
assignment" of the design done as a selection over one materialization instead
of one React render per assignment (256 renders of the same tree would only
reproduce subtrees React already rendered). The one place the materializer
does not render an alternative is when it sits more than
`MAX_ALTERNATIVE_DEPTH` branches off the preferred path or past the element
budget; it emits a truncated `$Unknown` there, which enumeration reports as a
`subtree` omission.

## Correlation

A branch's variable is the identity of its predicate, not its position:

- `truthy(<id>)` where `<id>` is the identity of the uncertain value being
  tested (`src/evaluate/predicates.ts`). `flag ? A : B` evaluated in three
  components off one `useFlag()` result is one variable → 2 states, not 8.
- `!truthy(<id>)` is read back as the same variable with its alternatives
  swapped, so `!flag ? B : A` decides together with `flag ? A : B`.
- `state(<cell>)` for a branch on a state cell.
- `path(<n>)` for a fork of statement paths (`if` bodies, early returns,
  loop exits): every binding joined at that fork shares the variable, as the
  operands of one SSA phi would; `branch#N` / `repeat#N` for markers without a
  predicate.

Repeated variables are scoped per iteration (`variable@repeat#3[1]`) so a
branch inside a `.map` callback is decided once per rendered item.

Correlation is by value identity within one interpretation. Two calls of the
same opaque hook produce two independent unknowns — the interpreter cannot know
they return the same value — so they multiply.

## Budget and omissions

`StateSpaceBudget` defaults to `{ maxStates: 256, maxRepeat: 2 }`.

- Repeats enumerate `min .. min + maxRepeat` cardinalities, clipped to the
  interpreter's `NumberRange` when it knows one (a mapped literal array is
  exact and produces one count and no omission). Counts above the bound are an
  `OmittedRepeatStates { countsAbove, max }`.
- When `states` reaches `maxStates`, the state that would have been emitted
  next is recorded as `OmittedState { conditions }` and every alternative the
  enumerator can no longer expand is an `OmittedBranchStates` /
  `OmittedRepeatStates` carrying the conditions already chosen when it was
  reached.
- Subtrees the materializer did not render are `OmittedSubtree`.

`omitted` is `null` only when every reachable state is in `states`. Nothing is
dropped without an entry here.

## Matching and status

`matchStateSpace` tries each committed pattern, latest first, with the
assignment-aware matcher (`compare.ts`): a branch variable already decided on
this attempt is reused, otherwise its alternatives are tried; repeats try
concrete counts. The decisions of a successful attempt become conditions and
are looked up in `states`.

- `exact` — the runtime equals one enumerated state and `omitted` is `null`.
- `truncated` — the runtime matched (an enumerated state, or an assignment
  outside `states`, reported with `index: null`) but the space is incomplete.
  Both the fixture suite and the corpus treat this as membership, never as
  exactness.
- `partial` — matched, but through an opaque subtree or wildcard.
- `mismatch` — no committed pattern matches under any assignment. The report
  carries the furthest divergence and `closestState`: the enumerated state that
  agrees with the failing attempt on the most decisions.

The report (`format-report.ts`) prints the number of states, the matched
state's conditions, the states never observed by this capture, and every
omission. `corpus/results.json` records `stateSpace: { states, matchedState,
closestState, omitted }` per entry, validated by the wrapper schema in
`src/corpus/summary.ts`.

## Where enumeration is necessarily bounded

- Repeat cardinality: unbounded lists get `min .. min + maxRepeat`; the rest is
  an omission.
- Independent branches multiply; `maxStates` cuts the product and the cut is
  recorded per alternative.
- Alternatives nested more than `MAX_ALTERNATIVE_DEPTH` off the preferred path,
  and anything past the materializer's element budget, are not rendered.
- Opaque externals: their subtree is a hole, not a set of states.
- Commits are those observed within the settle window; a timer that fires later
  is a state this run cannot see.
- Two unknowns the interpreter cannot prove equal are independent even when the
  program would always agree on them.
