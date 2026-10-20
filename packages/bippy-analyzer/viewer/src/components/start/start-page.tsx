import Link from "next/link";
import { getRouteHref } from "@/lib/route";
import type { Example } from "@/model";
import { StartShell } from "./start-shell";

interface StartPageProps {
  examples: Example[];
}

export const StartPage = ({ examples }: StartPageProps) => (
  <StartShell className="my-auto">
    <h1 className="text-base font-semibold tracking-tight">bippy analyzer</h1>
    <ul className="flex flex-col gap-1">
      {examples.map((example) => (
        <li key={example.name}>
          <Link
            href={getRouteHref(example.name)}
            className="font-mono text-foreground underline-offset-4 hover:underline"
          >
            {example.name}
          </Link>
        </li>
      ))}
    </ul>
  </StartShell>
);
