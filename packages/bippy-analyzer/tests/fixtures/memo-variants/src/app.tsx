import { forwardRef, memo } from "react";

const Plain = ({ label }: { label: string }) => <i>{label}</i>;

const SimpleMemo = memo(Plain);

const CompareMemo = memo(Plain, (prev, next) => prev.label === next.label);

const MemoForward = memo(
  forwardRef<HTMLElement, { label: string }>(function Inner({ label }, ref) {
    return <cite ref={ref}>{label}</cite>;
  }),
);

const InlineMemo = memo(() => <small>inline</small>);

const NamedMemo = memo(function NamedInner() {
  return <sub>named</sub>;
});
NamedMemo.displayName = "Renamed";

export const App = () => (
  <address>
    <SimpleMemo label="simple" />
    <CompareMemo label="compare" />
    <MemoForward label="forward" />
    <InlineMemo />
    <NamedMemo />
  </address>
);
