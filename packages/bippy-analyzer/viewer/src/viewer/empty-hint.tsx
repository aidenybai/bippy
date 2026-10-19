import { useExamples } from "../hooks/queries";
import { useViewer } from "./context";

const EXAMPLE_FOLDER = "symbolic-tree";

const Examples = () => {
  const { open } = useViewer();
  const examples = useExamples();
  const picks = examples.data?.filter((example) => example.folder === EXAMPLE_FOLDER) ?? [];
  if (picks.length === 0) return null;
  return (
    <p className="pointer-events-auto flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
      <span>or open</span>
      {picks.map((example) => (
        <button
          key={example.file}
          type="button"
          onClick={() => open({ kind: "file", file: example.file })}
          className="rounded-sm text-text-2 outline-none hover:text-foreground hover:underline focus-visible:shadow-focus"
        >
          {example.name}
        </button>
      ))}
    </p>
  );
};

export const EmptyHint = () => (
  <div className="pointer-events-none absolute inset-x-0 top-0 grid gap-3 px-16 py-1 text-text-2">
    <p>
      Paste or type a React component here. The analysis follows the code, and the code lives in the
      link.
    </p>
    <Examples />
  </div>
);
