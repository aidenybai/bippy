import NextLink from "next/link";
import type { ReactNode } from "react";

import { Link } from "@/components/ui/link";

interface GuideChapter {
  content: ReactNode;
  eyebrow: string;
  title: string;
}

interface InlineCodeProps {
  children: ReactNode;
}

interface GuideCodeProps {
  children: string;
  label?: string;
}

const InlineCode = ({ children }: InlineCodeProps) => (
  <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
    {children}
  </code>
);

const GuideCode = ({ children, label }: GuideCodeProps) => (
  <div className="my-6 overflow-hidden rounded-lg border border-border bg-card">
    {label ? (
      <div className="border-b border-border px-3 py-2 font-mono text-xs text-muted-foreground">
        {label}
      </div>
    ) : null}
    <pre className="overflow-x-auto bg-muted/30 p-3 font-mono text-xs leading-5 text-muted-foreground">
      <code>{children}</code>
    </pre>
  </div>
);

export const guideChapters: GuideChapter[] = [
  {
    eyebrow: "Part 1",
    title: "React keeps two trees.",
    content: (
      <>
        <p>
          The DOM is the host output: elements, attributes, and text. It does not know that a button
          came from <InlineCode>FollowButton</InlineCode>.
        </p>
        <p>
          Fiber keeps that missing structure. Each node can point to a component, its props and
          state, its owner, and the host element it produced.
        </p>
        <p>
          Toggle the example. The DOM has tags. Fiber still has component identity and render data.
        </p>
      </>
    ),
  },
  {
    eyebrow: "Part 2",
    title: "bippy pretends to be React DevTools.",
    content: (
      <>
        <p>
          React renderers report to <InlineCode>__REACT_DEVTOOLS_GLOBAL_HOOK__</InlineCode>. They
          call <InlineCode>inject()</InlineCode> once, then send committed roots to that hook.
        </p>
        <p>bippy installs a compatible hook and listens to the same events.</p>
        <p>
          It has to load first. In Next 15.3+, use{" "}
          <InlineCode>instrumentation-client.ts</InlineCode>. In Vite, import bippy before React.
        </p>
        <GuideCode label="instrumentation-client.ts">{`import "bippy";`}</GuideCode>
      </>
    ),
  },
  {
    eyebrow: "Part 3",
    title: "Subscribe with instrument().",
    content: (
      <>
        <p>
          <InlineCode>instrument()</InlineCode> registers renderer lifecycle handlers. Calls
          compose, so several tools can listen without replacing each other.
        </p>
        <p>
          <InlineCode>onActive</InlineCode> runs when a renderer connects.{" "}
          <InlineCode>onCommitFiberRoot</InlineCode> receives each committed root. The returned
          function removes that subscription.
        </p>
        <GuideCode label="observe-commits.ts">{`const unsubscribe = instrument({
  onActive: () => setReady(true),
  onCommitFiberRoot: (_, root) => inspect(root),
});

unsubscribe();`}</GuideCode>
      </>
    ),
  },
  {
    eyebrow: "Part 4",
    title: "A Fiber can exist without rendering.",
    content: (
      <>
        <p>
          <InlineCode>traverseFiber()</InlineCode> searches the tree. Use it to find children,
          siblings, or owners.
        </p>
        <p>
          <InlineCode>traverseRenderedFibers()</InlineCode> answers a different question: what
          mounted, updated, or unmounted in this commit?
        </p>
        <p>Pass the same root each time so bippy can compare the current and previous trees.</p>
      </>
    ),
  },
  {
    eyebrow: "Part 5",
    title: "A small render scanner.",
    content: (
      <>
        <p>
          Listen for a commit, visit the Fibers that updated, find each component&apos;s nearest
          host Fiber, then mark its DOM node.
        </p>
        <p>The example on the right is the basic loop behind a render visualizer.</p>
        <GuideCode label="mini-scan.ts">{`import {
  instrument,
  isCompositeFiber,
  isHostFiber,
  traverseFiber,
  traverseRenderedFibers,
} from "bippy";

instrument({
  onCommitFiberRoot: (_, root) => {
    traverseRenderedFibers(root, (fiber, phase) => {
      if (phase !== "update" || !isCompositeFiber(fiber)) return;

      const host = traverseFiber(fiber, (candidate) =>
        isHostFiber(candidate),
      );

      if (host?.stateNode instanceof HTMLElement) {
        host.stateNode.style.outline = "2px solid currentColor";
      }
    });
  },
});`}</GuideCode>
      </>
    ),
  },
  {
    eyebrow: "Part 6",
    title: "Go from the DOM back into React.",
    content: (
      <>
        <p>
          <InlineCode>getFiber(element)</InlineCode> returns the Fiber for a host instance. The
          picker on the homepage starts there.
        </p>
        <p>
          <InlineCode>getLatestFiber()</InlineCode> follows a retained Fiber to its current version.{" "}
          <InlineCode>isHostFiber()</InlineCode> and <InlineCode>isCompositeFiber()</InlineCode>{" "}
          identify the node kind. <InlineCode>getDisplayName()</InlineCode> gives it a useful name.
        </p>
        <p>
          Inside a component, <InlineCode>useFiber()</InlineCode> returns that component&apos;s
          Fiber. It returns undefined during server rendering.
        </p>
      </>
    ),
  },
  {
    eyebrow: "Part 7",
    title: "The inspector is only one use.",
    content: (
      <>
        <p>
          react-scan uses renderer data to find expensive renders. This site uses it to inspect a
          selected element. Source tooling can rebuild owner stacks and connect components to files.
        </p>
        <p>
          The same primitives work for visual editors, test recorders, accessibility tools, and
          component explorers.
        </p>
      </>
    ),
  },
  {
    eyebrow: "Part 8",
    title: "These are private internals.",
    content: (
      <>
        <p>
          A late hook can miss the renderer. Production builds can change what is available. React
          DevTools and refresh runtimes may already own the hook. Server Components have no client
          Fiber on the server.
        </p>
        <p>React internals also change between releases. bippy cannot turn them into a contract.</p>
        <p>
          Pin versions, test production builds, fail safely, and do not make app correctness depend
          on inspection.
        </p>
      </>
    ),
  },
  {
    eyebrow: "Recap",
    title: "The useful parts.",
    content: (
      <>
        <ul className="list-disc space-y-2 pl-5">
          <li>Load bippy before React.</li>
          <li>Use instrument() for renderer events.</li>
          <li>Use traverseRenderedFibers() for commit work.</li>
          <li>Use getFiber() to cross from a host node into React.</li>
          <li>Use traverseFiber() to search the tree.</li>
        </ul>
        <p>
          bippy is a small library for reading React&apos;s renderer protocol and Fiber tree. The
          README has the full API.
        </p>
        <div className="flex flex-wrap gap-x-4 gap-y-2 pt-2">
          <Link href="https://github.com/aidenybai/bippy#api-reference">API reference</Link>
          <NextLink
            className="rounded-sm text-muted-foreground underline decoration-border underline-offset-4 transition-colors hover:text-foreground"
            href="/llms.txt"
          >
            llms.txt
          </NextLink>
          <Link href="https://npmjs.com/package/bippy">npm</Link>
        </div>
      </>
    ),
  },
];
