import { forwardRef, lazy, memo, Suspense, type ReactNode, useImperativeHandle, useRef } from "react";

const Plain = ({ label }: { label: string }) => <span>{label}</span>;

const MemoPlain = memo(Plain);

const MemoAnonymous = memo(({ label }: { label: string }) => <em>{label}</em>);

const MemoWithCompare = memo(
  ({ label }: { label: string }) => <b>{label}</b>,
  (previous, next) => previous.label === next.label,
);

const Input = forwardRef<HTMLInputElement, { placeholder: string }>(function Input({ placeholder }, ref) {
  return <input ref={ref} placeholder={placeholder} />;
});

const Handle = forwardRef<{ focus: () => void }, { children: ReactNode }>((props, ref) => {
  const inner = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => ({ focus: () => inner.current?.focus() }));
  return <div ref={inner}>{props.children}</div>;
});
Handle.displayName = "Handle";

const MemoForwardRef = memo(Input);

const LazyPanel = lazy(() => import("./shared/panel"));

export default function Wrappers() {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div>
      <MemoPlain label="memo named" />
      <MemoAnonymous label="memo anonymous" />
      <MemoWithCompare label="memo compare" />
      <Input ref={ref} placeholder="type" />
      <Handle>handle</Handle>
      <MemoForwardRef placeholder="memo forwardRef" />
      <Suspense fallback={<p>loading…</p>}>
        <LazyPanel title="lazy" />
      </Suspense>
    </div>
  );
}
