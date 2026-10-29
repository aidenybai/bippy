# Goal

Find every state a React app can be in by reading its source, without running the app.

## Why

Tests can't reach every state. Today you find the rest by shipping to production and waiting for real users to hit them. If the states come from the code, you see them before anything runs.

Later, agents could check those states for bugs. That part is parked.

## Example

```tsx
function App({ isLoading }) {
  const [count, setCount] = useState(0);
  return isLoading ? <Loading /> : <Button onClick={() => setCount(count + 1)}>{count}</Button>;
}
```

The states:

```text
isLoading            → <Loading />
!isLoading, count=0  → <Button>{0}</Button>
click                → count + 1
```

`count` can be any number, so you can't list every state. You describe them with a rule instead: count starts at 0 and each click adds 1.

## How we check it

1. Pick some states from the model, such as count = 0, 1, and 6.
2. Render each one with React.
3. Compare the result with fibers captured from the real app.

If the real app shows something the model doesn't have, the model is wrong.

## Rules so far

- Only split on an unknown when it changes what renders. A fetch result that is only displayed stays one `Unknown`.
- Use TypeScript types to guess the possible values. `boolean` gives two cases, `User | null` gives two, and `any` gives `Unknown`.
- Stay with React for now. Its rules (pure render, state only through setters) keep the number of states manageable.

## Answers

The four questions this started with, and what the analyzer does.

1. **What does the output look like?** For each component, the data it reads, its render tree with every branch kept, and its states with the actions between them. [docs/symbolic-tree.md](docs/symbolic-tree.md) shows one for a form wizard.
2. **One model per component, or one for the app?** One per component. The project's own hooks run inline across files, so their state is the component's state. A context's setters are tied to the fields they set. Parents and children aren't linked yet.
3. **How deep into libraries?** React's own hooks are modeled, and zustand stores from their `create` call. Other hooks, like React Query's, take the values their return type allows. Calling into one may change it, and any hook from the same module, later. The verifier mounts each component inside the providers the app installs.
4. **How is the model built?** By our own interpreter. The React Compiler lowers each component to HIR, the TypeScript 7 checker types it, and the interpreter runs the HIR without executing it. Where branches merge, a value becomes a conditional, so no branch is lost.
