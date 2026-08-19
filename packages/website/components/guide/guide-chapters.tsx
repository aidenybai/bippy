import NextLink from "next/link";
import type { ReactNode } from "react";

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
  <code className="rounded bg-white/7 px-1.5 py-0.5 font-mono text-[0.82em] text-[#61dafb]">
    {children}
  </code>
);

const GuideCode = ({ children, label }: GuideCodeProps) => (
  <div className="my-7 overflow-hidden rounded-xl border border-white/10 bg-[#14161b]">
    {label ? (
      <div className="border-b border-white/8 px-4 py-2.5 font-mono text-xs text-white/35">
        {label}
      </div>
    ) : null}
    <pre className="overflow-x-auto p-4 font-mono text-xs leading-5 text-white/65">
      <code>{children}</code>
    </pre>
  </div>
);

export const guideChapters: GuideChapter[] = [
  {
    eyebrow: "Part 1 · two trees",
    title: "The DOM is the output. Fiber is the story.",
    content: (
      <>
        <p>
          The browser gives you a tree of elements: div, button, span. Useful, but flat. By the time
          React hands work to the DOM, component identity is gone.
        </p>
        <p>
          React keeps a second tree in memory. A Fiber can tell you the component type, its props
          and state, who owns it, the host element it produced, and what work is pending.
        </p>
        <p>
          Switch the lab between DOM and Fiber. Same interface. One is a soup of tags; the other
          still knows <InlineCode>Avatar</InlineCode> and <InlineCode>FollowButton</InlineCode>.
        </p>
      </>
    ),
  },
  {
    eyebrow: "Part 2 · the handshake",
    title: "React already phones home.",
    content: (
      <>
        <p>
          React renderers announce themselves through{" "}
          <InlineCode>__REACT_DEVTOOLS_GLOBAL_HOOK__</InlineCode>. React DevTools installs that
          hook, then React calls <InlineCode>inject()</InlineCode> and reports every committed root.
        </p>
        <p>
          bippy pretends to be DevTools. It installs a compatible hook, keeps the original
          callbacks working, and listens to the same commit stream.
        </p>
        <p>
          Timing is the whole trick: the hook must exist before the renderer loads. In Next 15.3+,
          use <InlineCode>instrumentation-client.ts</InlineCode>. In Vite, make bippy the first
          import in the entry file.
        </p>
        <GuideCode label="instrumentation-client.ts">{`import "bippy";`}</GuideCode>
      </>
    ),
  },
  {
    eyebrow: "Part 3 · one subscription",
    title: "instrument() is the front door.",
    content: (
      <>
        <p>
          Register the lifecycle events you care about. bippy patches each hook event once, then
          fans it out to every subscriber, so tools compose instead of wrapping each other forever.
        </p>
        <p>
          <InlineCode>onActive</InlineCode> tells you a renderer arrived.{" "}
          <InlineCode>onCommitFiberRoot</InlineCode> gives you the committed tree. The return value
          removes exactly your handlers.
        </p>
        <GuideCode label="observe-commits.ts">{`const unsubscribe = instrument({
  name: "my-render-tool",
  onActive: () => setReady(true),
  onCommitFiberRoot: (_, root) => inspect(root),
});

unsubscribe();`}</GuideCode>
      </>
    ),
  },
  {
    eyebrow: "Part 4 · only the work",
    title: "A Fiber exists. That does not mean it rendered.",
    content: (
      <>
        <p>
          <InlineCode>traverseFiber()</InlineCode> is a structural search. It walks children or
          owners until your selector returns true. Great for finding a host node. Wrong for
          answering “what rerendered in this commit?”
        </p>
        <p>
          <InlineCode>traverseRenderedFibers()</InlineCode> compares the current and previous trees
          for the same root. Its callback receives only work from that commit, tagged{" "}
          <InlineCode>mount</InlineCode>, <InlineCode>update</InlineCode>, or{" "}
          <InlineCode>unmount</InlineCode>.
        </p>
        <p>Keep passing the same root. That identity is how bippy remembers the previous tree.</p>
      </>
    ),
  },
  {
    eyebrow: "Part 5 · the payoff",
    title: "Build a tiny react-scan.",
    content: (
      <>
        <p>
          Now the pieces cash out. Subscribe to commits. Visit the Fibers that updated. Walk down
          to each component&apos;s nearest host Fiber. Outline its DOM node.
        </p>
        <p>
          Click either card in the lab. That cyan box is the entire idea behind a render
          visualizer—minus the production polish.
        </p>
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
        host.stateNode.style.outline = "2px solid #61dafb";
      }
    });
  },
});`}</GuideCode>
      </>
    ),
  },
  {
    eyebrow: "Part 6 · reverse lookup",
    title: "Go from a DOM node back into React.",
    content: (
      <>
        <p>
          <InlineCode>getFiber(element)</InlineCode> crosses from the rendered host instance into
          React&apos;s tree. That is the move behind the picker on the bippy homepage.
        </p>
        <p>
          From there, <InlineCode>getLatestFiber()</InlineCode> follows a retained Fiber to its
          current version. <InlineCode>isHostFiber()</InlineCode> and{" "}
          <InlineCode>isCompositeFiber()</InlineCode> tell host output from user components.{" "}
          <InlineCode>getDisplayName()</InlineCode> turns the type into a human label.
        </p>
        <p>
          Inside your own component, <InlineCode>useFiber()</InlineCode> skips the DOM lookup and
          returns the calling component&apos;s Fiber. On the server it returns undefined: there is
          no client Fiber there to inspect.
        </p>
      </>
    ),
  },
  {
    eyebrow: "Part 7 · what this unlocks",
    title: "The inspector is a demo. The library is the engine.",
    content: (
      <>
        <p>
          react-scan uses this territory to show expensive renders. This site&apos;s picker starts
          from a DOM element and finds the component that owns it. Source tooling can reconstruct
          owner stacks and connect components back to files.
        </p>
        <p>
          You can build performance overlays, visual editors, test recorders, accessibility
          auditors, component explorers, or the debugging tool React never shipped.
        </p>
        <p>
          The shared move is always the same: take React&apos;s private graph and turn it into a
          small, useful signal.
        </p>
      </>
    ),
  },
  {
    eyebrow: "Part 8 · read before shipping",
    title: "This is an escape hatch, not a contract.",
    content: (
      <>
        <p>
          Production dead-code elimination changes React&apos;s shape. A hook loaded after React
          misses the renderer handshake. Real DevTools or refresh runtimes may already own the
          hook. React Server Components do not create client Fibers on the server.
        </p>
        <p>
          And the big one: React internals change. Work tags move. fields change meaning. Renderers
          disagree. bippy absorbs a lot of that drift, but it cannot make private APIs public.
        </p>
        <p className="border-l border-orange-300/30 pl-4 text-orange-100/50">
          Pin versions, test production builds, fail soft, and never make app correctness depend on
          an inspection tool.
        </p>
      </>
    ),
  },
  {
    eyebrow: "Recap · five moves",
    title: "You do not need all of Fiber. You need the right doorway.",
    content: (
      <>
        <ol className="space-y-3 pl-0">
          {[
            "Load bippy before React so the DevTools hook is ready.",
            "Use instrument() to subscribe without fighting other tools.",
            "Use traverseRenderedFibers() for mount, update, and unmount work.",
            "Use getFiber() and traverseFiber() to cross between DOM and React.",
            "Treat every result as private internals that can change.",
          ].map((recapItem, recapIndex) => (
            <li key={recapItem} className="flex gap-3">
              <span className="font-mono text-xs text-[#61dafb]">0{recapIndex + 1}</span>
              <span>{recapItem}</span>
            </li>
          ))}
        </ol>
        <p>
          That is bippy: a library for listening to React&apos;s private renderer protocol, walking
          Fiber, and building tools on top.
        </p>
        <div className="flex flex-wrap gap-x-5 gap-y-2 pt-3 text-sm">
          <a
            className="text-[#61dafb] underline decoration-[#61dafb]/25 underline-offset-4 transition hover:text-white"
            href="https://github.com/aidenybai/bippy#api-reference"
          >
            API reference ↗
          </a>
          <NextLink
            className="text-[#61dafb] underline decoration-[#61dafb]/25 underline-offset-4 transition hover:text-white"
            href="/llms.txt"
          >
            llms.txt ↗
          </NextLink>
          <a
            className="text-[#61dafb] underline decoration-[#61dafb]/25 underline-offset-4 transition hover:text-white"
            href="https://npmjs.com/package/bippy"
          >
            npm ↗
          </a>
        </div>
      </>
    ),
  },
];
