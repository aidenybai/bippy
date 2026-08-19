"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { GuideShowcase } from "@/components/guide/guide-showcases";
import { cn } from "@/lib/utils";

interface GuideSectionProps {
  children: ReactNode;
  eyebrow: string;
  isActive: boolean;
  sectionIndex: number;
  sectionReference: (element: HTMLElement | null) => void;
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
    {label && (
      <div className="border-b border-white/8 px-4 py-2.5 font-mono text-[10px] text-white/35">
        {label}
      </div>
    )}
    <pre className="overflow-x-auto p-4 font-mono text-[11px] leading-5 text-white/65">
      <code>{children}</code>
    </pre>
  </div>
);

const GuideSection = ({
  children,
  eyebrow,
  isActive,
  sectionIndex,
  sectionReference,
  title,
}: GuideSectionProps) => (
  <section
    ref={sectionReference}
    className={cn(
      "flex min-h-[82vh] scroll-mt-12 flex-col justify-center py-20 transition-opacity duration-500 lg:min-h-[96vh] lg:py-28",
      isActive ? "lg:opacity-100" : "lg:opacity-32",
    )}
    data-guide-section={sectionIndex}
  >
    <p className="mb-4 font-mono text-[10px] font-medium tracking-[0.2em] text-[#61dafb] uppercase">
      {eyebrow}
    </p>
    <h2 className="max-w-xl text-2xl font-medium tracking-[-0.025em] text-white sm:text-3xl">
      {title}
    </h2>
    <div className="mt-6 max-w-xl space-y-5 text-[15px] leading-7 text-white/56">{children}</div>
    <div className="mt-10 lg:hidden">
      <GuideShowcase activeSectionIndex={sectionIndex} compact />
    </div>
  </section>
);

export const GuideEssay = () => {
  const [activeSectionIndex, setActiveSectionIndex] = useState(0);
  const sectionElements = useRef<Array<HTMLElement | null>>([]);

  useEffect(() => {
    let animationFrame = 0;

    const updateActiveSection = (): void => {
      animationFrame = 0;
      const viewportCenter = window.innerHeight / 2;
      let closestSectionIndex = 0;
      let closestDistance = Number.POSITIVE_INFINITY;

      sectionElements.current.forEach((sectionElement, sectionIndex) => {
        if (!sectionElement) return;
        const sectionBounds = sectionElement.getBoundingClientRect();
        const sectionCenter = sectionBounds.top + sectionBounds.height / 2;
        const distanceFromCenter = Math.abs(sectionCenter - viewportCenter);

        if (distanceFromCenter < closestDistance) {
          closestDistance = distanceFromCenter;
          closestSectionIndex = sectionIndex;
        }
      });

      setActiveSectionIndex(closestSectionIndex);
    };

    const requestActiveSectionUpdate = (): void => {
      if (animationFrame) return;
      animationFrame = window.requestAnimationFrame(updateActiveSection);
    };

    updateActiveSection();
    window.addEventListener("scroll", requestActiveSectionUpdate, { passive: true });
    window.addEventListener("resize", requestActiveSectionUpdate);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("scroll", requestActiveSectionUpdate);
      window.removeEventListener("resize", requestActiveSectionUpdate);
    };
  }, []);

  const getSectionReference =
    (sectionIndex: number) =>
    (sectionElement: HTMLElement | null): void => {
      sectionElements.current[sectionIndex] = sectionElement;
    };

  return (
    <main className="min-h-screen bg-[#0b0c0f] text-foreground selection:bg-[#61dafb]/25">
      <div className="mx-auto grid w-full max-w-[1536px] lg:grid-cols-[minmax(0,0.9fr)_minmax(34rem,1.1fr)]">
        <article className="px-6 sm:px-10 lg:px-14 xl:px-20">
          <header className="flex h-20 items-center justify-between">
            <a className="flex items-center gap-2.5" href="/">
              <Image src="/icon.png" alt="" width={24} height={24} priority />
              <span className="text-sm font-medium tracking-tight text-white">bippy</span>
            </a>
            <a
              className="font-mono text-[10px] tracking-[0.14em] text-white/35 uppercase transition hover:text-[#61dafb]"
              href="https://github.com/aidenybai/bippy"
            >
              GitHub ↗
            </a>
          </header>

          <section
            ref={getSectionReference(0)}
            className={cn(
              "flex min-h-[calc(100vh-5rem)] flex-col justify-center py-16 transition-opacity duration-500 lg:min-h-[calc(100vh-5rem)] lg:py-24",
              activeSectionIndex === 0 ? "lg:opacity-100" : "lg:opacity-32",
            )}
            data-guide-section="0"
          >
            <p className="mb-5 font-mono text-[10px] font-medium tracking-[0.2em] text-[#61dafb] uppercase">
              a field guide to React&apos;s other tree
            </p>
            <h1 className="max-w-2xl font-serif text-5xl leading-[0.98] font-normal tracking-[-0.045em] text-white sm:text-6xl xl:text-7xl">
              What bippy
              <br />
              actually is.
            </h1>
            <div className="mt-8 max-w-xl space-y-5 text-[15px] leading-7 text-white/58">
              <p>
                Give me one render and I&apos;ll show you the component that made it, what it
                received, and where React put it.
              </p>
              <p>
                Click the counter. The card on this page is only React UI. The render signal behind
                it is what bippy is built to catch.
              </p>
              <p className="border-l border-[#61dafb]/35 pl-4 text-white/38">
                bippy is not a browser extension or a DevTools panel. It is a tiny library you load
                into your app before React.
              </p>
            </div>
            <p className="mt-10 text-xs text-white/25 lg:hidden">
              This guide has a scroll-synced lab on desktop. You still get every experiment here.
            </p>
            <div className="mt-10 lg:hidden">
              <GuideShowcase activeSectionIndex={0} compact />
            </div>
          </section>

          <GuideSection
            eyebrow="Part 1 · two trees"
            isActive={activeSectionIndex === 1}
            sectionIndex={1}
            sectionReference={getSectionReference(1)}
            title="The DOM is the output. Fiber is the story."
          >
            <p>
              The browser gives you a tree of elements: div, button, span. Useful, but flat. By the
              time React hands work to the DOM, component identity is gone.
            </p>
            <p>
              React keeps a second tree in memory. A Fiber can tell you the component type, its
              props and state, who owns it, the host element it produced, and what work is pending.
            </p>
            <p>
              Switch the lab between DOM and Fiber. Same interface. One is a soup of tags; the
              other still knows <InlineCode>Avatar</InlineCode> and{" "}
              <InlineCode>FollowButton</InlineCode>.
            </p>
          </GuideSection>

          <GuideSection
            eyebrow="Part 2 · the handshake"
            isActive={activeSectionIndex === 2}
            sectionIndex={2}
            sectionReference={getSectionReference(2)}
            title="React already phones home."
          >
            <p>
              React renderers announce themselves through{" "}
              <InlineCode>__REACT_DEVTOOLS_GLOBAL_HOOK__</InlineCode>. React DevTools installs that
              hook, then React calls <InlineCode>inject()</InlineCode> and reports every committed
              root.
            </p>
            <p>
              bippy pretends to be DevTools. It installs a compatible hook, keeps the original
              callbacks working, and listens to the same commit stream.
            </p>
            <p>
              Timing is the whole trick: the hook must exist before the renderer loads. In Next
              15.3+, use <InlineCode>instrumentation-client.ts</InlineCode>. In Vite, make bippy the
              first import in the entry file.
            </p>
            <GuideCode label="instrumentation-client.ts">{`import "bippy";`}</GuideCode>
          </GuideSection>

          <GuideSection
            eyebrow="Part 3 · one subscription"
            isActive={activeSectionIndex === 3}
            sectionIndex={3}
            sectionReference={getSectionReference(3)}
            title="instrument() is the front door."
          >
            <p>
              Register the lifecycle events you care about. bippy patches each hook event once,
              then fans it out to every subscriber, so tools compose instead of wrapping each
              other forever.
            </p>
            <p>
              <InlineCode>onActive</InlineCode> tells you a renderer arrived.{" "}
              <InlineCode>onCommitFiberRoot</InlineCode> gives you the committed tree. The return
              value removes exactly your handlers.
            </p>
            <GuideCode label="observe-commits.ts">{`const unsubscribe = instrument({
  name: "my-render-tool",
  onActive: () => setReady(true),
  onCommitFiberRoot: (_, root) => inspect(root),
});

unsubscribe();`}</GuideCode>
          </GuideSection>

          <GuideSection
            eyebrow="Part 4 · only the work"
            isActive={activeSectionIndex === 4}
            sectionIndex={4}
            sectionReference={getSectionReference(4)}
            title="A Fiber exists. That does not mean it rendered."
          >
            <p>
              <InlineCode>traverseFiber()</InlineCode> is a structural search. It walks children or
              owners until your selector returns true. Great for finding a host node. Wrong for
              answering “what rerendered in this commit?”
            </p>
            <p>
              <InlineCode>traverseRenderedFibers()</InlineCode> compares the current and previous
              trees for the same root. Its callback receives only work from that commit, tagged{" "}
              <InlineCode>mount</InlineCode>, <InlineCode>update</InlineCode>, or{" "}
              <InlineCode>unmount</InlineCode>.
            </p>
            <p>
              Keep passing the same root. That identity is how bippy remembers the previous tree.
            </p>
          </GuideSection>

          <GuideSection
            eyebrow="Part 5 · the payoff"
            isActive={activeSectionIndex === 5}
            sectionIndex={5}
            sectionReference={getSectionReference(5)}
            title="Build a tiny react-scan."
          >
            <p>
              Now the pieces cash out. Subscribe to commits. Visit the Fibers that updated. Walk
              down to each component&apos;s nearest host Fiber. Outline its DOM node.
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
          </GuideSection>

          <GuideSection
            eyebrow="Part 6 · reverse lookup"
            isActive={activeSectionIndex === 6}
            sectionIndex={6}
            sectionReference={getSectionReference(6)}
            title="Go from a DOM node back into React."
          >
            <p>
              <InlineCode>getFiber(element)</InlineCode> crosses from the rendered host instance
              into React&apos;s tree. That is the move behind the picker on the bippy homepage.
            </p>
            <p>
              From there, <InlineCode>getLatestFiber()</InlineCode> follows a retained Fiber to its
              current version. <InlineCode>isHostFiber()</InlineCode> and{" "}
              <InlineCode>isCompositeFiber()</InlineCode> tell host output from user components.{" "}
              <InlineCode>getDisplayName()</InlineCode> turns the type into a human label.
            </p>
            <p>
              Inside your own component, <InlineCode>useFiber()</InlineCode> skips the DOM lookup
              and returns the calling component&apos;s Fiber. On the server it returns undefined:
              there is no client Fiber there to inspect.
            </p>
          </GuideSection>

          <GuideSection
            eyebrow="Part 7 · what this unlocks"
            isActive={activeSectionIndex === 7}
            sectionIndex={7}
            sectionReference={getSectionReference(7)}
            title="The inspector is a demo. The library is the engine."
          >
            <p>
              react-scan uses this territory to show expensive renders. This site&apos;s picker
              starts from a DOM element and finds the component that owns it. Source tooling can
              reconstruct owner stacks and connect components back to files.
            </p>
            <p>
              You can build performance overlays, visual editors, test recorders, accessibility
              auditors, component explorers, or the debugging tool React never shipped.
            </p>
            <p>
              The shared move is always the same: take React&apos;s private graph and turn it into a
              small, useful signal.
            </p>
          </GuideSection>

          <GuideSection
            eyebrow="Part 8 · read before shipping"
            isActive={activeSectionIndex === 8}
            sectionIndex={8}
            sectionReference={getSectionReference(8)}
            title="This is an escape hatch, not a contract."
          >
            <p>
              Production dead-code elimination changes React&apos;s shape. A hook loaded after
              React misses the renderer handshake. Real DevTools or refresh runtimes may already
              own the hook. React Server Components do not create client Fibers on the server.
            </p>
            <p>
              And the big one: React internals change. Work tags move. fields change meaning.
              Renderers disagree. bippy absorbs a lot of that drift, but it cannot make private
              APIs public.
            </p>
            <p className="border-l border-orange-300/30 pl-4 text-orange-100/50">
              Pin versions, test production builds, fail soft, and never make app correctness
              depend on an inspection tool.
            </p>
          </GuideSection>

          <GuideSection
            eyebrow="Recap · five moves"
            isActive={activeSectionIndex === 9}
            sectionIndex={9}
            sectionReference={getSectionReference(9)}
            title="You do not need all of Fiber. You need the right doorway."
          >
            <ol className="space-y-3 pl-0">
              {[
                "Load bippy before React so the DevTools hook is ready.",
                "Use instrument() to subscribe without fighting other tools.",
                "Use traverseRenderedFibers() for mount, update, and unmount work.",
                "Use getFiber() and traverseFiber() to cross between DOM and React.",
                "Treat every result as private internals that can change.",
              ].map((recapItem, recapIndex) => (
                <li key={recapItem} className="flex gap-3">
                  <span className="font-mono text-[10px] text-[#61dafb]">
                    0{recapIndex + 1}
                  </span>
                  <span>{recapItem}</span>
                </li>
              ))}
            </ol>
            <p>
              That is bippy: a library for listening to React&apos;s private renderer protocol,
              walking Fiber, and building tools on top.
            </p>
            <div className="flex flex-wrap gap-x-5 gap-y-2 pt-3 text-sm">
              <a
                className="text-[#61dafb] underline decoration-[#61dafb]/25 underline-offset-4 transition hover:text-white"
                href="https://github.com/aidenybai/bippy#api-reference"
              >
                API reference ↗
              </a>
              <a
                className="text-[#61dafb] underline decoration-[#61dafb]/25 underline-offset-4 transition hover:text-white"
                href="/llms.txt"
              >
                llms.txt ↗
              </a>
              <a
                className="text-[#61dafb] underline decoration-[#61dafb]/25 underline-offset-4 transition hover:text-white"
                href="https://npmjs.com/package/bippy"
              >
                npm ↗
              </a>
            </div>
          </GuideSection>

          <footer className="flex items-center justify-between border-t border-white/8 py-8 text-[11px] text-white/25">
            <span>bippy · React internals without the ceremony</span>
            <a className="transition hover:text-white" href="/">
              back to the inspector
            </a>
          </footer>
        </article>

        <aside className="relative hidden lg:block">
          <div className="sticky top-0 flex h-dvh items-center p-6 xl:p-8">
            <GuideShowcase activeSectionIndex={activeSectionIndex} />
          </div>
        </aside>
      </div>
    </main>
  );
};
