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

## Open questions

1. What does the output look like? Write it by hand for the example above before picking an engine.
2. One model per component, or one for the whole app?
3. How deep do we go into libraries like React Query or Redux?
4. How do we build the model: our own interpreter, a real JS engine, or running the code many times?
