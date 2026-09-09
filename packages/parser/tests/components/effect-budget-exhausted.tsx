import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

interface Editor {
  shapeCount: number;
  getCrashingError(): Error | null;
}

const SHAPE_COUNT = 200;

/** More work than the evaluator's budget affords, done in an effect: the state it sets is unknown, nothing else is. */
const createEditor = (): Editor => {
  const shapes = new Map<string, { index: number; label: string }>();
  for (let index = 0; index < SHAPE_COUNT; index++) {
    const id = `shape:${index}`;
    const label = id.split(":").join("-").toUpperCase();
    shapes.set(id, { index, label });
  }
  let shapeCount = 0;
  for (const [id, shape] of shapes) {
    if (shape.label.startsWith("SHAPE") && id.length > 0) shapeCount++;
  }
  return { shapeCount, getCrashingError: () => null };
};

const useRefState = <T,>(initialValue: T): [T, (value: T) => void] => {
  const ref = useRef(initialValue);
  const [state, setState] = useState(initialValue);
  if (state !== ref.current) setState(ref.current);
  const update = useCallback((value: T) => {
    ref.current = value;
    setState(ref.current);
  }, []);
  return [state, update];
};

const Canvas = ({ editor }: { editor: Editor }) => (
  <section>
    <h1>ready</h1>
    <p>{editor.shapeCount} shapes</p>
  </section>
);

const Crash = ({ crashingError }: { crashingError: Error }): null => {
  throw crashingError;
};

export const maxSteps = 2_000;
export const isPartial = true;
export const minCoverage = 0.8;

export default function EffectBudgetExhausted() {
  const [editor, setEditor] = useRefState<Editor | null>(null);
  useLayoutEffect(() => {
    const nextEditor = createEditor();
    setEditor(nextEditor);
  }, []);
  const crashingError = useSyncExternalStore(
    useCallback(() => () => {}, []),
    () => editor?.getCrashingError() ?? null,
  );
  if (!editor) return <div className="loading" />;
  return (
    <main>
      {crashingError ? <Crash crashingError={crashingError} /> : <Canvas editor={editor} />}
    </main>
  );
}
