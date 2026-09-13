import { Activity, Profiler, StrictMode, Suspense } from "react";
import { createPortal } from "react-dom";

const Inner = ({ label }: { label: string }) => <span>{label}</span>;

export default function Builtins() {
  return (
    <StrictMode>
      <div>
        <Profiler id="profiler" onRender={() => {}}>
          <Inner label="profiled" />
        </Profiler>
        <Suspense fallback={<p>fallback</p>}>
          <Inner label="suspense" />
        </Suspense>
        <Suspense fallback={null}>
          <Inner label="first" />
          <Inner label="second" />
        </Suspense>
        <Activity mode="visible">
          <Inner label="visible" />
        </Activity>
        <Activity mode="hidden">
          <Inner label="hidden" />
        </Activity>
        {createPortal(<Inner label="portal" />, document.body)}
      </div>
    </StrictMode>
  );
}
