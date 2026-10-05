import { useEffect, useId, useReducer, useTransition } from "react";
import { useItems } from "./use-items";

const reducer = (state: { open: boolean }, action: "toggle") =>
  action === "toggle" ? { open: !state.open } : state;

const RenderProp = ({ children }: { children: (value: number) => React.ReactNode }) => (
  <>{children(42)}</>
);

export const App = () => {
  const { items, upper, add } = useItems(["a", "b"]);
  const [state, dispatch] = useReducer(reducer, { open: false });
  const [isPending] = useTransition();
  const id = useId();
  useEffect(() => {
    if (items.length > 5) add("z");
  }, [items, add]);
  return (
    <div id={id} aria-busy={isPending}>
      {upper.map((item) => (
        <span key={item}>{item}</span>
      ))}
      {state.open && <details />}
      <button onClick={() => dispatch("toggle")}>toggle</button>
      <RenderProp>{(value) => <data value={value}>{value}</data>}</RenderProp>
    </div>
  );
};
