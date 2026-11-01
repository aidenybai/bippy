# Goal

Derive a state chart of a React app from its source, without running it, and check invariants against it.

## Why

Tests can't reach every state. Today you find the rest by shipping to production and waiting for real users to hit them. If the states come from the code, you see them before anything runs.

## Example

```tsx
function App({ isLoading }) {
  const [count, setCount] = useState(0);
  return isLoading ? <Loading /> : <Button onClick={() => setCount(count + 1)}>{count}</Button>;
}
```

The model:

```text
variables  isLoading: false | true (a prop, so it can change at any time)
views      isLoading → <Loading />
           !isLoading → <Button>
actions    click, when !isLoading: changes nothing the render tests
```

`count` can be any number, but no branch tests it, so it isn't a variable. The model only tracks values that decide what renders. The click still shows as a transition from `<Button>` to itself.

## The source is the spec

The model comes from the code, so it can't tell you the code is right. It can tell you three things the code didn't intend:

- **Unreachable branches.** A branch no reachable state renders, like an error alert nothing sets.
- **Stuttering actions.** A handler or failed request that never changes the render.
- **Violated assertions.** A `x!`, `as` or `invariant()` the code makes that a reachable state violates.

For anything else, you write the invariant. `analyze -i 'Name: expression'` checks a TLA+ invariant on every reachable state and prints a trace when it fails. The invariant is your spec, and the model is what the code does.

## How we check the model

The model over-approximates: every render the component can produce should be one of its reachable states. Conformance mounts real components in a browser, explores them, and reports any render or transition the model can't explain. See [README.md](README.md#how-verification-works).

## Rules so far

- Split a value only where a branch or handler tests it.
- Use TypeScript types for the possible values. `boolean` gives two values, `User | null` gives two, and `any` gives one.
- Treat props, hooks, context and stores as inputs that can change at any time.
- Stay with React for now. Its rules, pure render and state only through setters, keep the number of states small.
