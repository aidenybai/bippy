import { Spinner } from "@/components/ui/spinner";
import { useExamples } from "../hooks/queries";
import type { Example } from "../model";
import { useViewer } from "./context";

const groupByFolder = (examples: Example[]): [string, Example[]][] => {
  const groups = new Map<string, Example[]>();
  for (const example of examples) {
    const group = groups.get(example.folder) ?? [];
    group.push(example);
    groups.set(example.folder, group);
  }
  return [...groups.entries()];
};

const ExampleRow = ({ example, isFirst }: { example: Example; isFirst: boolean }) => {
  const { openFile } = useViewer();
  return (
    <li className="grid grid-cols-[9.5rem_minmax(0,1fr)_auto] items-baseline gap-4 border-t py-2.5">
      <span className="text-muted-foreground">{isFirst ? example.folder : ""}</span>
      <button
        type="button"
        onClick={() => openFile(example.file)}
        className="truncate rounded-sm text-left text-foreground outline-none hover:underline focus-visible:shadow-focus"
      >
        {example.name}
      </button>
      <span className="text-muted-foreground tabular-nums">{example.lines} lines</span>
    </li>
  );
};

export const Start = () => {
  const examples = useExamples();
  return (
    <div className="h-full overflow-y-auto overscroll-none">
      <div className="mx-auto grid max-w-xl gap-8 px-4 py-10 sm:px-5">
        <div className="grid gap-3">
          <h1 className="font-medium text-foreground">bippy analyzer</h1>
          <p className="text-text-2">
            Point it at a React component file and it shows what the analyzer found: every state
            variable, every state the component can be in, and every action that moves it between
            them, drawn over the code.
          </p>
          <p className="text-text-2">
            Paste a path above and press Enter, or open one of the fixtures below.
          </p>
        </div>
        <div className="grid gap-2">
          <h2 className="text-muted-foreground">Examples</h2>
          {examples.data ? (
            <ul className="border-b">
              {groupByFolder(examples.data).flatMap(([, group]) =>
                group.map((example, index) => (
                  <ExampleRow key={example.file} example={example} isFirst={index === 0} />
                )),
              )}
            </ul>
          ) : examples.error ? (
            <p className="text-destructive">{examples.error.message}</p>
          ) : (
            <Spinner className="h-24" />
          )}
        </div>
      </div>
    </div>
  );
};
