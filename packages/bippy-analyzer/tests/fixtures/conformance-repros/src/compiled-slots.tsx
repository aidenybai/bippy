import { c as _c } from "react/compiler-runtime";

export function CompiledSlots(props: { onDone: (value: string) => void }) {
  const $ = _c(4);
  let dismiss;
  if ($[0] !== props.onDone) {
    dismiss = () => props.onDone("dismiss");
    $[1] = dismiss;
  }
  let cached;
  if ($[2] === Symbol.for("react.memo_cache_sentinel")) {
    cached = $[2];
  }
  let pair;
  if ($[3] === Symbol.for("react.memo_cache_sentinel")) {
    pair = [cached, {}];
    $[3] = pair;
  }
  return <i>{String(dismiss)}</i>;
}
