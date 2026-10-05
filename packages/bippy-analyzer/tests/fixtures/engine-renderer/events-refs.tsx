import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";

interface Handle {
  read: () => string;
}
const trace: string[] = [];
export const getTrace = () => trace.slice();
const Field = forwardRef<Handle>((_props, reference) => {
  const input = useRef<HTMLInputElement>(null);
  useImperativeHandle(reference, () => ({ read: () => input.current?.value ?? "missing" }), []);
  useLayoutEffect(() => {
    if (input.current) input.current.value = "ready";
    trace.push("layout");
    return () => {
      trace.push("cleanup");
    };
  }, []);
  return <input ref={input} defaultValue="initial" />;
});
const EventsRefs = () => {
  const reference = useRef<Handle>(null);
  const [label, setLabel] = useState("idle");
  return (
    <section>
      <Field ref={reference} />
      <button
        onClick={(event) => {
          event.preventDefault();
          trace.push(`${event.type}:${event.currentTarget.tagName}:${event.isDefaultPrevented()}`);
          const current = event.currentTarget;
          setLabel(reference.current?.read() ?? "missing");
          queueMicrotask(() => {
            trace.push(`after:${event.currentTarget === null}:${current.tagName}`);
          });
        }}
      >
        read
      </button>
      <output>{label}</output>
    </section>
  );
};
export default EventsRefs;
