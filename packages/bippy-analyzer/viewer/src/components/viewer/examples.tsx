import Link from "next/link";
import { getRouteHref } from "@/lib/route";
import type { Example } from "@/model";
import { useViewer } from "./context";

const ExampleRow = ({ example }: { example: Example }) => (
  <li>
    <Link
      href={getRouteHref(example.name)}
      className="block w-full rounded-md px-3 py-2 text-left font-mono text-foreground outline-none transition-colors duration-150 hover:bg-muted focus-visible:shadow-focus"
    >
      {example.name}
    </Link>
  </li>
);

export const Examples = () => {
  const { examples } = useViewer();
  return (
    <div className="grid h-full grid-cols-[minmax(0,28rem)] content-center justify-center overflow-y-auto overscroll-none px-4 py-8 sm:px-5">
      <ul className="-mx-3 grid gap-1">
        {examples.map((example) => (
          <ExampleRow key={example.name} example={example} />
        ))}
      </ul>
    </div>
  );
};
