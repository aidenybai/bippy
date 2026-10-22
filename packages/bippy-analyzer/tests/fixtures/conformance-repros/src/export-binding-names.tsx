import { forwardRef, memo, useState } from "react";

export const OtherNameMemo = memo(function Impl() {
  const [on, setOn] = useState(false);
  return <button onClick={() => setOn(!on)}>{on ? "on" : "off"}</button>;
});

export const ForwardNamed = forwardRef<HTMLButtonElement>(function ForwardNamedImpl(_props, ref) {
  const [on, setOn] = useState(false);
  return (
    <button ref={ref} onClick={() => setOn(!on)}>
      {on ? "on" : "off"}
    </button>
  );
});

export const NamedExpr = function NamedExprImpl() {
  const [on, setOn] = useState(false);
  return <button onClick={() => setOn(!on)}>{on ? "on" : "off"}</button>;
};

export const SameNameMemo = memo(function SameNameMemo() {
  const [on, setOn] = useState(false);
  return <button onClick={() => setOn(!on)}>{on ? "on" : "off"}</button>;
});

const LocalMemo = memo(function LocalImpl({ label }: { label: string }) {
  const [on, setOn] = useState(false);
  return <button onClick={() => setOn(!on)}>{on ? label : "off"}</button>;
});

export const Parent = () => <LocalMemo label="hi" />;
