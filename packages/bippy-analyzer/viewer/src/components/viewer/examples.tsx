import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { viewQuery } from "@/hooks/queries";
import { useHighlighter } from "@/hooks/use-highlighter";
import type { Example } from "@/model";
import { useViewer } from "./context";

const usePrefetch = (examples: Example[]): void => {
  const queryClient = useQueryClient();
  useHighlighter();
  useEffect(() => {
    for (const example of examples) void queryClient.prefetchQuery(viewQuery(example.file));
  }, [examples, queryClient]);
};

const ExampleRow = ({ example }: { example: Example }) => {
  const { open } = useViewer();
  return (
    <li>
      <button
        type="button"
        onClick={() => open(example.file)}
        className="grid w-full gap-0.5 rounded-md px-3 py-2 text-left outline-none transition-colors duration-150 hover:bg-muted focus-visible:shadow-focus"
      >
        <span className="font-mono text-foreground">{example.name}</span>
        <span className="text-muted-foreground">{example.summary}</span>
      </button>
    </li>
  );
};

export const Examples = () => {
  const { examples } = useViewer();
  usePrefetch(examples);
  return (
    <div className="grid h-full place-content-center overflow-y-auto overscroll-none px-4 py-8 sm:px-5">
      <ul className="-mx-3 grid w-full max-w-md gap-1">
        {examples.map((example) => (
          <ExampleRow key={example.file} example={example} />
        ))}
      </ul>
    </div>
  );
};
