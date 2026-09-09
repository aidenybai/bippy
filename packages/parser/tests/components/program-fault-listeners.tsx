import { useEffect, useRef, useState } from "react";

// `error`, `unhandledrejection` and `rejectionhandled` on `window` report the
// program's own uncaught faults, which the analysis evaluates itself: none is
// dispatched when its evaluation reaches the capture without one.
const useFaultReporter = () => {
  const hasFault = useRef(false);
  const [report, setReport] = useState<string | null>(null);
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      hasFault.current = true;
      setReport(String(event.error));
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      hasFault.current = true;
      setReport(String(event.reason));
    };
    const onHandled = () => {
      setReport(null);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection, { capture: false, passive: true });
    window.addEventListener("rejectionhandled", onHandled);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener("rejectionhandled", onHandled);
    };
  }, []);
  return report;
};

const FaultToast = () => {
  const report = useFaultReporter();
  if (report === null) return null;
  return <output>{report}</output>;
};

export default function ProgramFaultListeners() {
  return (
    <section>
      <FaultToast />
      <p>content</p>
    </section>
  );
}

export const isExact = true;
