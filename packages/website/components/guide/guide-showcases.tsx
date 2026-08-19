"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";

interface GuideShowcaseProps {
  activeSectionIndex: number;
  compact?: boolean;
}

interface ShowcaseFrameProps {
  children: React.ReactNode;
  compact: boolean;
  sectionIndex: number;
}

interface CodeWindowProps {
  children: React.ReactNode;
  filename: string;
}

interface TreeLineProps {
  children: React.ReactNode;
  depth?: number;
  isActive?: boolean;
  tone?: "accent" | "muted" | "plain";
}

interface PhaseRowProps {
  name: string;
  phase: "mount" | "unmount" | "update";
}

const accentText = "text-[#61dafb]";
const accentBackground = "bg-[#61dafb]";

const TreeLine = ({ children, depth = 0, isActive = false, tone = "plain" }: TreeLineProps) => (
  <div
    className={cn(
      "flex h-7 items-center rounded-sm px-2 font-mono text-xs",
      isActive && "bg-[#61dafb]/12",
      tone === "accent" && accentText,
      tone === "muted" && "text-white/38",
      tone === "plain" && "text-white/75",
    )}
    style={{ paddingLeft: `${depth * 14 + 8}px` }}
  >
    <span className="mr-1.5 text-white/25">›</span>
    {children}
  </div>
);

const CodeWindow = ({ children, filename }: CodeWindowProps) => (
  <div className="overflow-hidden rounded-xl border border-white/10 bg-black/35">
    <div className="flex h-9 items-center justify-between border-b border-white/8 px-3 font-mono text-[10px] text-white/40">
      <span>{filename}</span>
      <span className={accentText}>● live</span>
    </div>
    <pre className="overflow-x-auto p-4 font-mono text-[11px] leading-5 text-white/66">
      <code>{children}</code>
    </pre>
  </div>
);

const ShowcaseFrame = ({ children, compact, sectionIndex }: ShowcaseFrameProps) => (
  <div
    className={cn(
      "relative flex min-h-0 w-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#14161b] shadow-2xl shadow-black/35",
      compact ? "h-[430px]" : "h-[min(760px,calc(100dvh-3rem))]",
    )}
  >
    <div className="flex h-11 shrink-0 items-center justify-between border-b border-white/8 px-4">
      <div className="flex gap-1.5">
        <span className="size-2 rounded-full bg-white/15" />
        <span className="size-2 rounded-full bg-white/15" />
        <span className={cn("size-2 rounded-full", accentBackground)} />
      </div>
      <span className="font-mono text-[10px] tracking-[0.18em] text-white/35">
        {String(sectionIndex + 1).padStart(2, "0")} / 10
      </span>
    </div>
    <div className="min-h-0 flex-1 p-4 sm:p-6">{children}</div>
  </div>
);

const IntroShowcase = () => {
  const [renderCount, setRenderCount] = useState(1);

  return (
    <div className="flex h-full flex-col justify-between gap-6">
      <div>
        <p className="mb-2 font-mono text-[10px] tracking-[0.2em] text-white/35 uppercase">
          a live render
        </p>
        <h3 className="text-xl font-medium tracking-tight text-white">Counter</h3>
      </div>
      <button
        className="group relative mx-auto flex aspect-square w-48 flex-col items-center justify-center rounded-full border border-[#61dafb]/35 bg-[#61dafb]/6 transition hover:bg-[#61dafb]/10 active:scale-[0.98]"
        onClick={() => setRenderCount((currentRenderCount) => currentRenderCount + 1)}
        type="button"
      >
        <span className="font-mono text-[10px] tracking-[0.2em] text-[#61dafb]/70 uppercase">
          click to render
        </span>
        <span className="mt-2 text-6xl font-light tabular-nums text-white">{renderCount - 1}</span>
        <span className="absolute inset-3 rounded-full border border-[#61dafb]/10 transition group-hover:inset-2" />
      </button>
      <div className="rounded-xl border border-white/8 bg-black/25 p-3 font-mono text-[11px]">
        <div className="flex justify-between text-white/38">
          <span>component</span>
          <span className={accentText}>Counter</span>
        </div>
        <div className="mt-2 flex justify-between text-white/38">
          <span>renders observed</span>
          <span className="text-white/80">{renderCount}</span>
        </div>
      </div>
    </div>
  );
};

const TwoTreesShowcase = () => {
  const [isFiberVisible, setIsFiberVisible] = useState(true);

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="grid grid-cols-2 rounded-lg bg-black/25 p-1 text-xs">
        <button
          className={cn(
            "rounded-md px-3 py-2 transition",
            !isFiberVisible ? "bg-white/10 text-white" : "text-white/38",
          )}
          onClick={() => setIsFiberVisible(false)}
          type="button"
        >
          DOM
        </button>
        <button
          className={cn(
            "rounded-md px-3 py-2 transition",
            isFiberVisible ? "bg-[#61dafb]/12 text-[#61dafb]" : "text-white/38",
          )}
          onClick={() => setIsFiberVisible(true)}
          type="button"
        >
          Fiber
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-white/8 bg-black/20 p-3">
        {isFiberVisible ? (
          <div>
            <TreeLine tone="muted">HostRoot</TreeLine>
            <TreeLine depth={1} tone="accent">
              App
            </TreeLine>
            <TreeLine depth={2} tone="accent">
              ProfileCard
            </TreeLine>
            <TreeLine depth={3}>article</TreeLine>
            <TreeLine depth={4} tone="accent" isActive>
              Avatar
            </TreeLine>
            <TreeLine depth={5}>img</TreeLine>
            <TreeLine depth={4} tone="accent">
              FollowButton
            </TreeLine>
            <TreeLine depth={5}>button</TreeLine>
            <div className="mt-4 border-t border-white/8 pt-4 font-mono text-[11px] leading-6 text-white/45">
              <p>
                <span className="text-white/25">props </span>
                {'{ size: 40, status: "online" }'}
              </p>
              <p>
                <span className="text-white/25">state </span>
                {"{ isFollowing: false }"}
              </p>
              <p>
                <span className="text-white/25">owner </span>
                <span className={accentText}>ProfileCard</span>
              </p>
            </div>
          </div>
        ) : (
          <div>
            <TreeLine tone="muted">html</TreeLine>
            <TreeLine depth={1} tone="muted">
              body
            </TreeLine>
            <TreeLine depth={2}>main</TreeLine>
            <TreeLine depth={3}>article.card</TreeLine>
            <TreeLine depth={4}>div.flex</TreeLine>
            <TreeLine depth={5} isActive>
              img.rounded-full
            </TreeLine>
            <TreeLine depth={4}>button.bg-cyan</TreeLine>
            <div className="mt-5 rounded-lg border border-dashed border-white/10 p-4 text-center text-xs leading-5 text-white/35">
              The DOM knows boxes and attributes.
              <br />
              It forgot who made them.
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const HookShowcase = () => (
  <div className="flex h-full flex-col justify-center">
    <div className="relative space-y-7">
      {[
        ["01", 'import "bippy"', "install the hook"],
        ["02", "renderer.inject()", "React phones home"],
        ["03", "onCommitFiberRoot", "every committed tree"],
      ].map(([step, label, detail], stepIndex) => (
        <div key={step} className="relative flex items-center gap-4">
          {stepIndex < 2 && (
            <div className="absolute top-12 left-[19px] h-7 w-px bg-gradient-to-b from-[#61dafb]/60 to-[#61dafb]/10" />
          )}
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full border border-[#61dafb]/25 bg-[#61dafb]/8 font-mono text-[10px] text-[#61dafb]">
            {step}
          </div>
          <div className="min-w-0 flex-1 rounded-xl border border-white/8 bg-black/20 px-4 py-3">
            <p className="truncate font-mono text-xs text-white/80">{label}</p>
            <p className="mt-1 text-xs text-white/35">{detail}</p>
          </div>
        </div>
      ))}
    </div>
    <div className="mt-9 rounded-xl border border-[#61dafb]/15 bg-[#61dafb]/5 p-4 text-sm leading-6 text-white/58">
      bippy takes the same handshake React DevTools uses. It just arrives first.
    </div>
  </div>
);

const InstrumentShowcase = () => {
  const [isSubscribed, setIsSubscribed] = useState(true);

  return (
    <div className="flex h-full flex-col gap-4">
      <CodeWindow filename="instrument.ts">
        <span className={accentText}>{"const unsubscribe"}</span>
        {" = instrument({\n"}
        {"  onActive() {\n"}
        {"    ready()\n"}
        {"  },\n"}
        {"  onCommitFiberRoot(_, root) {\n"}
        {"    inspect(root)\n"}
        {"  },\n"}
        {"})"}
      </CodeWindow>
      <div className="flex items-center justify-between rounded-xl border border-white/8 bg-black/20 p-4">
        <div>
          <p className="text-sm text-white/75">commit listener</p>
          <p className="mt-1 font-mono text-[10px] text-white/30">
            {isSubscribed ? "receiving roots" : "unsubscribed"}
          </p>
        </div>
        <button
          className={cn(
            "rounded-full border px-3 py-1.5 font-mono text-[10px] transition",
            isSubscribed
              ? "border-[#61dafb]/30 bg-[#61dafb]/10 text-[#61dafb]"
              : "border-white/10 text-white/35",
          )}
          onClick={() => setIsSubscribed((currentValue) => !currentValue)}
          type="button"
        >
          {isSubscribed ? "active" : "resume"}
        </button>
      </div>
      <div className="mt-auto grid grid-cols-2 gap-3 text-center">
        <div className="rounded-lg border border-white/8 p-3">
          <p className="text-lg text-white">1</p>
          <p className="mt-1 text-[10px] text-white/35">patched hook</p>
        </div>
        <div className="rounded-lg border border-white/8 p-3">
          <p className="text-lg text-white">∞</p>
          <p className="mt-1 text-[10px] text-white/35">subscriptions</p>
        </div>
      </div>
    </div>
  );
};

const PhaseRow = ({ name, phase }: PhaseRowProps) => (
  <div className="flex items-center justify-between rounded-lg border border-white/8 bg-black/18 px-3 py-2.5">
    <span className="font-mono text-xs text-white/65">{name}</span>
    <span
      className={cn(
        "rounded-full px-2 py-0.5 font-mono text-[9px]",
        phase === "mount" && "bg-emerald-400/10 text-emerald-300",
        phase === "update" && "bg-[#61dafb]/10 text-[#61dafb]",
        phase === "unmount" && "bg-orange-400/10 text-orange-300",
      )}
    >
      {phase}
    </span>
  </div>
);

const RenderedFibersShowcase = () => {
  const [commitNumber, setCommitNumber] = useState(1);
  const isInitialCommit = commitNumber === 1;

  return (
    <div className="flex h-full flex-col">
      <div className="mb-5 flex items-end justify-between">
        <div>
          <p className="font-mono text-[10px] tracking-[0.18em] text-white/30 uppercase">commit</p>
          <p className="mt-1 text-3xl font-light text-white">#{commitNumber}</p>
        </div>
        <button
          className="rounded-full bg-white px-4 py-2 text-xs font-medium text-black transition hover:bg-[#61dafb]"
          onClick={() => setCommitNumber((currentCommitNumber) => currentCommitNumber + 1)}
          type="button"
        >
          update count
        </button>
      </div>
      <div className="space-y-2">
        <PhaseRow name="Counter" phase={isInitialCommit ? "mount" : "update"} />
        <PhaseRow name="button" phase={isInitialCommit ? "mount" : "update"} />
        {isInitialCommit && <PhaseRow name="StaticFooter" phase="mount" />}
      </div>
      <div className="mt-5 rounded-xl border border-white/8 bg-black/20 p-4 font-mono text-[10px] leading-5 text-white/38">
        <p className="text-white/65">traverseRenderedFibers(root)</p>
        <p className="mt-2">
          visited <span className={accentText}>{isInitialCommit ? 3 : 2}</span> fibers
        </p>
        <p>
          skipped <span className="text-white/65">{isInitialCommit ? 0 : 1}</span> unchanged branch
        </p>
      </div>
      <p className="mt-auto text-xs leading-5 text-white/30">
        A full walk sees everything. A rendered walk sees what changed now.
      </p>
    </div>
  );
};

const MiniScanShowcase = () => {
  const [firstCount, setFirstCount] = useState(0);
  const [secondCount, setSecondCount] = useState(0);
  const [highlightedCard, setHighlightedCard] = useState<"first" | "second">("first");

  const updateFirstCard = (): void => {
    setFirstCount((currentCount) => currentCount + 1);
    setHighlightedCard("first");
  };

  const updateSecondCard = (): void => {
    setSecondCount((currentCount) => currentCount + 1);
    setHighlightedCard("second");
  };

  return (
    <div className="flex h-full flex-col">
      <div className="mb-4 flex items-center justify-between">
        <p className="font-mono text-[10px] tracking-[0.18em] text-white/30 uppercase">
          mini react-scan
        </p>
        <span className="flex items-center gap-1.5 text-[10px] text-white/35">
          <span className="size-1.5 animate-pulse rounded-full bg-[#61dafb]" />
          watching
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        <button
          className={cn(
            "relative rounded-xl border bg-black/20 p-5 text-left transition",
            highlightedCard === "first"
              ? "border-[#61dafb] shadow-[0_0_0_3px_rgba(97,218,251,0.1)]"
              : "border-white/8",
          )}
          onClick={updateFirstCard}
          type="button"
        >
          <span className="text-xs text-white/35">Inbox</span>
          <span className="mt-5 block text-4xl font-light text-white">{firstCount}</span>
          {highlightedCard === "first" && (
            <span className="absolute -top-2 left-3 rounded bg-[#61dafb] px-1.5 py-0.5 font-mono text-[8px] text-black">
              Counter · update
            </span>
          )}
        </button>
        <button
          className={cn(
            "relative rounded-xl border bg-black/20 p-5 text-left transition",
            highlightedCard === "second"
              ? "border-[#61dafb] shadow-[0_0_0_3px_rgba(97,218,251,0.1)]"
              : "border-white/8",
          )}
          onClick={updateSecondCard}
          type="button"
        >
          <span className="text-xs text-white/35">Drafts</span>
          <span className="mt-5 block text-4xl font-light text-white">{secondCount}</span>
          {highlightedCard === "second" && (
            <span className="absolute -top-2 left-3 rounded bg-[#61dafb] px-1.5 py-0.5 font-mono text-[8px] text-black">
              Counter · update
            </span>
          )}
        </button>
      </div>
      <CodeWindow filename="scan.ts">
        {"traverseRenderedFibers(root, (fiber, phase) => {\n"}
        {'  if (phase !== "update") return\n'}
        {"  const host = traverseFiber(fiber,\n"}
        {"    (candidate) => isHostFiber(candidate))\n"}
        {"  outline(host?.stateNode)\n"}
        {"})"}
      </CodeWindow>
    </div>
  );
};

const ReverseLookupShowcase = () => {
  const [selectedElement, setSelectedElement] = useState("button");

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="rounded-xl border border-white/8 bg-black/20 p-4">
        <div className="flex items-center gap-3">
          <button
            aria-label="Inspect avatar"
            className={cn(
              "size-11 rounded-full border bg-gradient-to-br from-[#61dafb]/35 to-violet-400/20 transition",
              selectedElement === "avatar"
                ? "border-[#61dafb] ring-3 ring-[#61dafb]/10"
                : "border-white/10",
            )}
            onClick={() => setSelectedElement("avatar")}
            type="button"
          />
          <div className="min-w-0 flex-1">
            <button
              className={cn(
                "rounded border px-1 text-left text-sm text-white transition",
                selectedElement === "name" ? "border-[#61dafb]" : "border-transparent",
              )}
              onClick={() => setSelectedElement("name")}
              type="button"
            >
              Aiden
            </button>
            <p className="mt-1 text-xs text-white/35">@aidenybai</p>
          </div>
          <button
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs transition",
              selectedElement === "button"
                ? "border-[#61dafb] bg-[#61dafb]/10 text-[#61dafb]"
                : "border-white/10 text-white/65",
            )}
            onClick={() => setSelectedElement("button")}
            type="button"
          >
            Follow
          </button>
        </div>
      </div>
      <div className="flex items-center justify-center gap-2 py-1 font-mono text-[10px] text-white/28">
        <span>DOM node</span>
        <span className={accentText}>→</span>
        <span>getFiber</span>
        <span className={accentText}>→</span>
        <span>owner</span>
      </div>
      <div className="min-h-0 flex-1 rounded-xl border border-white/8 bg-black/20 p-3">
        <TreeLine tone="plain">
          {selectedElement === "button" ? "button" : selectedElement === "avatar" ? "img" : "span"}
        </TreeLine>
        <TreeLine depth={1} tone="accent" isActive>
          {selectedElement === "button"
            ? "FollowButton"
            : selectedElement === "avatar"
              ? "Avatar"
              : "ProfileName"}
        </TreeLine>
        <TreeLine depth={2} tone="accent">
          ProfileCard
        </TreeLine>
        <TreeLine depth={3} tone="accent">
          PeoplePage
        </TreeLine>
        <div className="mt-4 border-t border-white/8 px-2 pt-4 font-mono text-[10px] leading-6 text-white/35">
          <p>
            latest <span className="text-white/65">getLatestFiber(fiber)</span>
          </p>
          <p>
            kind <span className="text-white/65">isCompositeFiber → true</span>
          </p>
        </div>
      </div>
    </div>
  );
};

const BuiltWithShowcase = () => (
  <div className="grid h-full auto-rows-fr grid-cols-2 gap-3">
    {[
      ["react-scan", "render heat"],
      ["bippy.dev", "fiber picker"],
      ["owner stacks", "who rendered this"],
      ["source maps", "where it lives"],
    ].map(([title, detail], itemIndex) => (
      <div
        key={title}
        className={cn(
          "flex flex-col justify-between rounded-xl border p-4",
          itemIndex === 0 ? "border-[#61dafb]/30 bg-[#61dafb]/7" : "border-white/8 bg-black/20",
        )}
      >
        <span className="font-mono text-[9px] text-white/25">0{itemIndex + 1}</span>
        <div>
          <p className={cn("text-sm font-medium", itemIndex === 0 ? accentText : "text-white/75")}>
            {title}
          </p>
          <p className="mt-1 text-xs text-white/30">{detail}</p>
        </div>
      </div>
    ))}
  </div>
);

const FailureShowcase = () => (
  <div className="flex h-full flex-col">
    <div className="mb-5 flex items-center gap-3">
      <div className="flex size-9 items-center justify-center rounded-full border border-orange-300/20 bg-orange-300/8 text-orange-200">
        !
      </div>
      <div>
        <p className="text-sm text-white/75">sharp tools, sharp edges</p>
        <p className="text-xs text-white/30">know when the hook goes quiet</p>
      </div>
    </div>
    <div className="space-y-2">
      {[
        ["load order", "hook installed after React"],
        ["production", "internals changed or stripped"],
        ["DevTools", "another hook owns the handshake"],
        ["server", "RSC has no client Fiber"],
      ].map(([title, detail]) => (
        <div
          key={title}
          className="flex items-center justify-between gap-4 rounded-lg border border-white/8 bg-black/20 px-3 py-3"
        >
          <span className="font-mono text-[10px] text-orange-200/70">{title}</span>
          <span className="text-right text-[11px] text-white/32">{detail}</span>
        </div>
      ))}
    </div>
    <div className="mt-auto rounded-xl border border-orange-300/15 bg-orange-300/5 p-4 text-xs leading-5 text-orange-100/55">
      React internals are not a contract. Pin, test, fail soft, and expect repairs.
    </div>
  </div>
);

const RecapShowcase = () => (
  <div className="flex h-full flex-col justify-between gap-6">
    <div>
      <p className="font-mono text-[10px] tracking-[0.18em] text-[#61dafb] uppercase">you got it</p>
      <h3 className="mt-3 max-w-sm text-3xl font-light tracking-tight text-white">
        React renders.
        <br />
        bippy listens.
      </h3>
    </div>
    <div className="space-y-3">
      {[
        "install before React",
        "subscribe to commits",
        "visit only rendered Fibers",
        "walk between DOM and components",
        "build the impossible tool",
      ].map((item) => (
        <div key={item} className="flex items-center gap-3 text-sm text-white/58">
          <span className="flex size-5 items-center justify-center rounded-full bg-[#61dafb]/10 font-mono text-[10px] text-[#61dafb]">
            ✓
          </span>
          {item}
        </div>
      ))}
    </div>
    <a
      className="flex items-center justify-between rounded-xl border border-[#61dafb]/25 bg-[#61dafb]/8 p-4 text-sm text-[#61dafb] transition hover:bg-[#61dafb]/12"
      href="https://github.com/aidenybai/bippy#api-reference"
    >
      open the API reference
      <span aria-hidden="true">↗</span>
    </a>
  </div>
);

const showcaseComponents = [
  IntroShowcase,
  TwoTreesShowcase,
  HookShowcase,
  InstrumentShowcase,
  RenderedFibersShowcase,
  MiniScanShowcase,
  ReverseLookupShowcase,
  BuiltWithShowcase,
  FailureShowcase,
  RecapShowcase,
];

export const GuideShowcase = ({ activeSectionIndex, compact = false }: GuideShowcaseProps) => {
  const ActiveShowcase = showcaseComponents[activeSectionIndex] ?? IntroShowcase;

  return (
    <ShowcaseFrame key={activeSectionIndex} compact={compact} sectionIndex={activeSectionIndex}>
      <ActiveShowcase />
    </ShowcaseFrame>
  );
};
