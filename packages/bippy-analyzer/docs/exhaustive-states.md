# Exhaustive reachable states

The static render used to answer "what does this tree look like?" with one tree
whose uncertain spots were inline maybe-nodes (`$Branch` rendering a preferred
alternative, `$Repeat` absorbing any count). That is one state with hedges, not
the set of states the source can reach. The harness now reads the materialized
tree back into one **guarded symbolic tree** — the first-class static artifact —
and derives everything else from it: the states, the membership check of a
runtime capture, which guard sides the captures witnessed, and the inputs a
future run would have to install to witness the rest.

## The symbolic tree (`src/harness/symbolic-tree.ts`)

```ts
interface SymbolicTree {
  inputs: InputVariable[]; // every symbolic input, with provenance
  commits: SymbolicCommit[]; // one guarded pattern per distinct committed tree
  stats: SymbolicTreeStats; // nodes, inputs, guards, branches, repeats, opaque, wildcards
}

interface InputVariable {
  id: string; // stable within one analysis: "#12", or "commit"
  label: string; // what the interpreter saw: "fetch('/api/me').json()", "state open"
  source: InputSourceKind; // fetch | loader | database | environment | feature-flag | viewport
  //                          | clock | random | storage | location | state | commit | root-props
  //                          | collection | path | unknown
  location: string | null; // file:line:column of where the value entered
}

interface SymbolicVariable {
  input: string; // InputVariable.id
  path: string[]; // property path; "[]" is "an element of"
  measure: "value" | "length" | "typeof" | "choice";
}
```

A **guard** is a boolean formula over symbolic variables:

```
constant(true|false)
truthy(v)                    eq(v, literal)         compare(v, < <= > >=, n)
in-set(v, [literals])        not(g)                 and(g…)      or(g…)
```

`ne` is `not(eq(…))`, `has-length(v, n)` is `eq(len(v), n)` and
`compare(len(v), …)`: the `length` measure of a variable is its own domain, so
no separate connective is needed. `typeof(v)` is likewise a measure, which is
how `typeof user === "object" && user !== null && user.role === "admin"` becomes
`and(eq(typeof(#1), "object"), not(eq(#1, null)), eq(#1.role, "admin"))` over
one input. Guards are serialized through a zod schema (`guardSchema`,
`symbolicTreeSchema`) and are what `corpus/results.json` carries.

The pattern nodes keep their shape (`static-pattern.ts`) and gain guards:

- `PatternBranch` — `guards[i]` is the guard under which alternative `i` is
  taken, `inputs` the inputs those guards mention, `variable` the identity of
  the decision (the serialized predicate).
- `PatternRepeat` — `cardinality` is `len(<collection variable>)`; `count` is
  the interpreter's known range. Decisions in the body are scoped per iteration
  and see the element variable `collection[]`.
- `PatternOpaque` / `PatternWildcard` — honest leaves with a `reason`. They are
  never guards: a subtree of unknown shape is a hole, not a set of states.

Multiple commits are the alternatives of the `commit` input:
`SymbolicCommit.guard` is `eq(choice(commit), i)`.

### Where guards come from

Guards are not a second inference. The interpreter records, on the uncertain
values it creates, how each was derived (`src/evaluate/predicates.ts`):

- **input sources** — a value entering from a fetch response, loader data, a
  database result, `process.env`, a feature flag, `matchMedia`/`innerWidth`,
  `Date.now`/`Math.random`, storage, `location`, root props, or an unmodeled
  call (`unknown`) gets an `InputSourceKind` and the location of the read;
- **derivations** — `obj.key`, `list[i]`/`.map` elements, `.length`, `typeof`,
  aliases, `=== literal`, `< n`, `[…].includes(x)`, and `a && b` / `a || b`
  each record what they were computed from.

`getTruthinessPredicate(test)` resolves a tested value through those records to
a guard over the root inputs. An alias resolves to what it aliases, a negation
flips the guard, a property walk extends the path, a comparison against a
literal becomes `eq`/`compare`/`in-set`, and a branch value that is itself
tested later (`const isAdmin = user.role === "admin"; if (isAdmin)`) resolves to
its alternatives' own guards. A value with no derivation is a root input of its
own, so two unknowns the interpreter cannot prove equal stay independent.

`&&`/`||` are modeled for what the harness uses them for — truthiness:
`truthy(a && b)` is `and(truthy(a), truthy(b))`. Their returned _value_ is not
resolved through the logical derivation; a later `(a && b) === "x"` is a fresh
input rather than a wrong correlation.

Identity is stable by construction: the same `StaticValue` object always maps
to the same input id, so a hook result tested in three components, or a
response tested at the root and again three levels down, is one variable.

## Deriving states (`src/harness/enumerate-states.ts`)

`enumerateStates(tree, budget)` is a generator; `enumerateStateSpace(commits,
budget)` wraps it in the `StaticStateSpace` view the report and corpus read:

```ts
interface StaticStateSpace {
  tree: SymbolicTree;
  commits: PatternNode[][]; // the trees of tree.commits
  commitStates: CommitStateSpace[]; // per commit: independent guard clusters
  stateCount: number; // consistent states, enumerated or not
  readonly states: StaticState[]; // the first budget.maxStates, built on first read
  readonly omitted: OmittedStateSpace | null;
}
```

Decisions are grouped into **clusters**: two decisions are in one cluster when
they mention a common input (before any iteration scope) or one nests inside
the other. Each cluster is enumerated on its own under a finite-domain solver
(`guard-solver.ts`): a decision's side is only taken when its guard is jointly
satisfiable with the guards already taken on this path, so contradictory
combinations never exist rather than being enumerated and filtered.
`stateCount` is the product of the cluster sizes; whole states are only
instantiated when `states` is read, latest cluster varying fastest, and
`stateAt(index)` addresses any of them by mixed radix without building the
others.

Two unrelated guards therefore cost 2 + 2 cluster states and a tree of constant
size, not 4 trees; ten unrelated flags are 20 cluster states and 1024
addressable whole states, of which `states` instantiates 256.

Conditions on a state are unchanged:

- `branch` / `state-update` — variable, reason, location, chosen alternative;
- `repeat` — variable, location, concrete cardinality;
- `transition` — which committed tree (of how many).

## Budget and omissions

`StateSpaceBudget` defaults to `{ maxStates: 256, maxRepeat: 2 }` and is not
raised. Two kinds of incompleteness are kept apart:

- **`omissions`** — the tree itself is not fully enumerated: repeat counts
  above `min + maxRepeat` (`OmittedRepeatStates`), alternatives or cluster
  states a cluster stopped listing at `maxStates` (`OmittedBranchStates`,
  `OmittedState`), and subtrees the materializer did not render
  (`OmittedSubtree`).
- **`droppedStates`** — whole states of a complete tree past `maxStates`,
  counted from the cluster sizes without being instantiated.

`omitted` is `null` only when every reachable state is in `states`.

## Membership (`matchStateSpace`)

The runtime tree is matched against each committed pattern, latest first, by
the assignment-aware comparer (`compare.ts`) under a `DecisionConstraint`: a
side is only tried when its guard stays satisfiable with the sides already
taken, and a variable met again reuses its decision. The comparer itself is
unchanged — it still requires hierarchy, tags, names, keys, host elements and
text to agree — the constraint only prunes decisions it may take.

The decisions of a successful attempt are located cluster by cluster
(`findState`): the member exists when every cluster lists them. Its global
index is computed, not searched; a member past `maxStates` is reported with
`index: null`. No whole state is instantiated to decide membership.

- `exact` — the runtime is a member and `omissions` is empty. Dropped whole
  states do not make a member inexact: the tree is complete and the member was
  solved from it.
- `truncated` — the runtime matched, but only under decisions the tree omitted
  (a repeat count above the bound, an unrendered alternative, a truncated
  cluster).
- `partial` — matched through an opaque subtree or wildcard.
- `mismatch` — no committed pattern matches under any satisfiable assignment;
  `closestState` is the enumerated state agreeing on the most decisions.

## Guard coverage (`src/harness/guard-coverage.ts`)

`computeGuardCoverage(tree, captures)` reports every guard side — each branch
alternative, each commit, and for each repeat its fewest count and "more than
the fewest" — as one of:

- `witnessed` — a capture's matched conditions took this side;
- `possible` — no capture took it, but it is satisfiable together with the
  guards on the path above it;
- `unreachable` — it contradicts a guard above it (an `eq(user.role, "guest")`
  test inside `eq(user.role, "admin")`).

`exact` requires the capture to be a member with no mismatched guard;
unwitnessed sides are reported as `possible`, never hidden, and never count
against exactness — they are what the next capture should go after. Numeric
fiber coverage (matched fibers over runtime fibers) is a separate figure and is
unchanged. Coverage is part of the harness result and of `corpus/results.json`
(`coverage` in `src/corpus/summary.ts`).

## Witness planning (`src/harness/witness-plan.ts`)

`planWitnesses(tree)` returns typed input assignments that together take every
reachable guard side:

```ts
interface WitnessPlan {
  witnesses: Array<{ assignments: InputAssignment[]; covers: CoveredSide[] }>;
  unreachable: CoveredSide[]; // sides no assignment reaches
  uncovered: CoveredSide[]; // reachable sides the planner could not pin down
}
interface InputAssignment {
  input: InputVariable; // where to install it: a response, storage, the viewport…
  variable: SymbolicVariable;
  value: string | number | boolean | null | { typeof: TypeName };
}
```

Each side's path condition is solved for one model; the models are candidates
and the plan is chosen greedily, each step adding the candidate deciding the
most sides not yet covered. Greedy set cover is within `ln(k) + 1` of the fewest
witnesses, `k` the most sides one candidate covers. The harness does not
execute plans; `witnessPlanSchema` is the contract for a browser capturer that
installs the assignments.

## Rendering (`formatSymbolicTree`)

The agent-facing view lists every input with its provenance, the tree with the
guard of every alternative inline (`|0 eq(user.role, "admin")`), repeats as
`*d2 len(#3.items) in [0, ∞)`, opaque and wildcard leaves as such, and per
commit one decision table per independent cluster, rows being consistent
assignments (`d1|0  d2|1`).

## Where enumeration is necessarily bounded

- Repeat cardinality: unbounded lists get `min .. min + maxRepeat`; the rest is
  an omission.
- A cluster whose own consistent assignments exceed `maxStates` is truncated;
  clusters never multiply into each other before the budget is applied.
- Alternatives nested more than `MAX_ALTERNATIVE_DEPTH` off the preferred path,
  and anything past the materializer's element budget, are not rendered.
- Opaque externals: their subtree is a hole, not a set of states.
- Commits are those observed within the settle window; a timer that fires later
  is a state this run cannot see.
- Two unknowns the interpreter cannot prove equal are independent even when the
  program would always agree on them.
- Whether a database-driven redirect (`prisma.user.findFirst()` deciding
  `redirect("/auth/setup")`) is taken is a guard over a `database` input; the
  static side lists both sides, and only a capture against a database in each
  state can witness both.
