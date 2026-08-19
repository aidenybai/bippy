"use client";

import { useState, type ReactNode } from "react";

import { FiberTreeDemo } from "@/components/fiber-tree";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface GuideShowcaseProps {
  activeSectionIndex: number;
}

interface ShowcaseFrameProps {
  children: ReactNode;
}

interface ShowcaseHeaderProps {
  children: ReactNode;
  description?: string;
}

interface CodeBlockProps {
  children: ReactNode;
  filename: string;
}

interface TreeRowProps {
  children: ReactNode;
  depth?: number;
}

interface PhaseRowProps {
  name: string;
  phase: "mount" | "unmount" | "update";
}

const ShowcaseHeader = ({ children, description }: ShowcaseHeaderProps) => (
  <div>
    <h3 className="text-sm font-medium text-foreground">{children}</h3>
    {description ? (
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
    ) : null}
  </div>
);

const CodeBlock = ({ children, filename }: CodeBlockProps) => (
  <div className="overflow-hidden rounded-lg border border-border bg-background">
    <div className="border-b border-border px-3 py-2 font-mono text-xs text-muted-foreground">
      {filename}
    </div>
    <pre className="overflow-x-auto p-3 font-mono text-xs leading-5 text-muted-foreground">
      <code>{children}</code>
    </pre>
  </div>
);

const TreeRow = ({ children, depth = 0 }: TreeRowProps) => (
  <div
    className="flex h-7 items-center rounded-sm font-mono text-xs text-muted-foreground"
    style={{ paddingLeft: `${depth * 14 + 8}px` }}
  >
    <span className="mr-1.5 text-border">›</span>
    {children}
  </div>
);

const ShowcaseFrame = ({ children }: ShowcaseFrameProps) => (
  <figure className="flex min-h-[420px] w-full min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card p-4 text-card-foreground">
    {children}
  </figure>
);

const IntroShowcase = () => (
  <div className="flex h-full min-h-0 flex-col gap-4">
    <ShowcaseHeader description="The homepage inspector is built with bippy. It calls getFiber() on its own UI.">
      inspect this page
    </ShowcaseHeader>
    <div className="min-h-0 flex-1">
      <FiberTreeDemo />
    </div>
  </div>
);

const TwoTreesShowcase = () => {
  const [isFiberVisible, setIsFiberVisible] = useState(true);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <ShowcaseHeader description="Same UI, different tree.">DOM and Fiber</ShowcaseHeader>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={isFiberVisible ? "outline" : "secondary"}
            onClick={() => setIsFiberVisible(false)}
          >
            DOM
          </Button>
          <Button
            size="sm"
            variant={isFiberVisible ? "secondary" : "outline"}
            onClick={() => setIsFiberVisible(true)}
          >
            Fiber
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {isFiberVisible ? (
          <FiberTreeDemo />
        ) : (
          <div className="h-80 overflow-hidden rounded-lg border border-border bg-background p-3">
            <TreeRow>html</TreeRow>
            <TreeRow depth={1}>body</TreeRow>
            <TreeRow depth={2}>main</TreeRow>
            <TreeRow depth={3}>article</TreeRow>
            <TreeRow depth={4}>div</TreeRow>
            <TreeRow depth={5}>img</TreeRow>
            <TreeRow depth={4}>button</TreeRow>
            <div className="mt-4 border-t border-border p-3 text-xs leading-relaxed text-muted-foreground">
              The DOM has elements and attributes. Component names, owners, props, and hooks are in
              Fiber.
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const HookShowcase = () => (
  <div className="flex h-full flex-col gap-4">
    <ShowcaseHeader description="bippy installs the same global hook used by React DevTools.">
      renderer handshake
    </ShowcaseHeader>
    <div className="flex flex-1 flex-col justify-center">
      {[
        ['import "bippy"', "install the hook"],
        ["renderer.inject()", "React registers the renderer"],
        ["onCommitFiberRoot", "React reports each commit"],
      ].map(([label, description], rowIndex) => (
        <div key={label}>
          <div className="rounded-lg border border-border bg-background p-3">
            <p className="font-mono text-xs text-foreground">{label}</p>
            <p className="mt-1 text-xs text-muted-foreground">{description}</p>
          </div>
          {rowIndex < 2 ? (
            <div className="flex h-6 items-center pl-4 text-sm text-muted-foreground">↓</div>
          ) : null}
        </div>
      ))}
    </div>
    <p className="rounded-lg bg-muted p-3 text-xs leading-relaxed text-muted-foreground">
      Import order matters. The hook has to exist before the renderer loads.
    </p>
  </div>
);

const InstrumentShowcase = () => {
  const [isSubscribed, setIsSubscribed] = useState(true);

  return (
    <div className="flex h-full flex-col gap-4">
      <ShowcaseHeader description="Multiple calls compose. The returned function removes one subscription.">
        instrument()
      </ShowcaseHeader>
      <CodeBlock filename="instrument.ts">
        {"const unsubscribe = instrument({\n"}
        {"  onActive: () => setReady(true),\n"}
        {"  onCommitFiberRoot: (_, root) => {\n"}
        {"    inspect(root)\n"}
        {"  },\n"}
        {"})"}
      </CodeBlock>
      <div className="mt-auto flex items-center justify-between rounded-lg border border-border p-3">
        <div>
          <p className="text-sm text-foreground">commit listener</p>
          <p className="text-xs text-muted-foreground">
            {isSubscribed ? "receiving roots" : "unsubscribed"}
          </p>
        </div>
        <Button
          size="sm"
          variant={isSubscribed ? "secondary" : "outline"}
          onClick={() => setIsSubscribed((currentValue) => !currentValue)}
        >
          {isSubscribed ? "unsubscribe" : "subscribe"}
        </Button>
      </div>
    </div>
  );
};

const PhaseRow = ({ name, phase }: PhaseRowProps) => (
  <div className="flex items-center justify-between border-b border-border px-3 py-2.5 last:border-b-0">
    <span className="font-mono text-xs text-foreground">{name}</span>
    <span className="rounded bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">
      {phase}
    </span>
  </div>
);

const RenderedFibersShowcase = () => {
  const [commitNumber, setCommitNumber] = useState(1);
  const isInitialCommit = commitNumber === 1;

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <ShowcaseHeader description="Only Fibers that rendered in this commit are visited.">
          rendered Fibers
        </ShowcaseHeader>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setCommitNumber((currentCommitNumber) => currentCommitNumber + 1)}
        >
          update
        </Button>
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-background">
        <PhaseRow name="Counter" phase={isInitialCommit ? "mount" : "update"} />
        <PhaseRow name="button" phase={isInitialCommit ? "mount" : "update"} />
        {isInitialCommit ? <PhaseRow name="StaticFooter" phase="mount" /> : null}
      </div>
      <div className="rounded-lg bg-muted p-3 font-mono text-xs leading-5 text-muted-foreground">
        <p>commit: {commitNumber}</p>
        <p>visited: {isInitialCommit ? 3 : 2}</p>
        <p>unchanged branches skipped: {isInitialCommit ? 0 : 1}</p>
      </div>
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
    <div className="flex h-full flex-col gap-4">
      <ShowcaseHeader description="Click a component. The selected host node is the latest update.">
        mini react-scan
      </ShowcaseHeader>
      <div className="grid grid-cols-2 gap-3">
        <Button
          className={cn(
            "h-auto items-start justify-start rounded-lg p-4 text-left",
            highlightedCard === "first" && "ring-2 ring-ring",
          )}
          variant="outline"
          onClick={updateFirstCard}
        >
          <span>
            <span className="block text-xs text-muted-foreground">Inbox</span>
            <span className="mt-3 block text-2xl font-medium text-foreground">{firstCount}</span>
          </span>
        </Button>
        <Button
          className={cn(
            "h-auto items-start justify-start rounded-lg p-4 text-left",
            highlightedCard === "second" && "ring-2 ring-ring",
          )}
          variant="outline"
          onClick={updateSecondCard}
        >
          <span>
            <span className="block text-xs text-muted-foreground">Drafts</span>
            <span className="mt-3 block text-2xl font-medium text-foreground">{secondCount}</span>
          </span>
        </Button>
      </div>
      <CodeBlock filename="scan.ts">
        {"traverseRenderedFibers(root, (fiber, phase) => {\n"}
        {'  if (phase !== "update") return\n'}
        {"  const host = traverseFiber(fiber,\n"}
        {"    (candidate) => isHostFiber(candidate))\n"}
        {"  outline(host?.stateNode)\n"}
        {"})"}
      </CodeBlock>
    </div>
  );
};

const ReverseLookupShowcase = () => {
  const [selectedElement, setSelectedElement] = useState("button");

  return (
    <div className="flex h-full flex-col gap-4">
      <ShowcaseHeader description="Pick a DOM node, then walk its owner chain.">
        DOM to Fiber
      </ShowcaseHeader>
      <div className="flex items-center gap-3 rounded-lg border border-border bg-background p-3">
        <Button
          aria-label="Inspect avatar"
          className="size-10 rounded-full"
          size="icon"
          variant={selectedElement === "avatar" ? "secondary" : "outline"}
          onClick={() => setSelectedElement("avatar")}
        >
          AB
        </Button>
        <Button
          className="min-w-0 flex-1 justify-start"
          size="sm"
          variant={selectedElement === "name" ? "secondary" : "ghost"}
          onClick={() => setSelectedElement("name")}
        >
          Aiden
        </Button>
        <Button
          size="sm"
          variant={selectedElement === "button" ? "secondary" : "outline"}
          onClick={() => setSelectedElement("button")}
        >
          Follow
        </Button>
      </div>
      <div className="rounded-lg border border-border bg-background p-3">
        <TreeRow>
          {selectedElement === "button" ? "button" : selectedElement === "avatar" ? "div" : "span"}
        </TreeRow>
        <TreeRow depth={1}>
          {selectedElement === "button"
            ? "FollowButton"
            : selectedElement === "avatar"
              ? "Avatar"
              : "ProfileName"}
        </TreeRow>
        <TreeRow depth={2}>ProfileCard</TreeRow>
        <TreeRow depth={3}>PeoplePage</TreeRow>
      </div>
      <div className="rounded-lg bg-muted p-3 font-mono text-xs leading-5 text-muted-foreground">
        <p>getLatestFiber(fiber)</p>
        <p>isCompositeFiber(fiber) → true</p>
      </div>
    </div>
  );
};

const BuiltWithShowcase = () => (
  <div className="flex h-full flex-col gap-4">
    <ShowcaseHeader description="Different tools, same access to React's renderer.">
      built with bippy
    </ShowcaseHeader>
    <div className="overflow-hidden rounded-lg border border-border bg-background">
      {[
        ["react-scan", "find expensive renders"],
        ["bippy.dev", "inspect the current page"],
        ["owner stacks", "find who rendered a component"],
        ["source tools", "connect components to files"],
      ].map(([title, description]) => (
        <div
          key={title}
          className="flex items-center justify-between gap-4 border-b border-border px-3 py-3 last:border-b-0"
        >
          <span className="text-sm font-medium text-foreground">{title}</span>
          <span className="text-right text-xs text-muted-foreground">{description}</span>
        </div>
      ))}
    </div>
  </div>
);

const FailureShowcase = () => (
  <div className="flex h-full flex-col gap-4">
    <ShowcaseHeader description="Private internals have failure modes.">
      check these first
    </ShowcaseHeader>
    <div className="overflow-hidden rounded-lg border border-border bg-background">
      {[
        ["load order", "the hook loaded after React"],
        ["production", "the build changed React internals"],
        ["DevTools", "another hook owns the handshake"],
        ["server", "RSC has no client Fiber"],
      ].map(([title, description]) => (
        <div
          key={title}
          className="border-b border-border px-3 py-3 last:border-b-0 sm:flex sm:items-center sm:justify-between sm:gap-4"
        >
          <span className="font-mono text-xs text-foreground">{title}</span>
          <span className="mt-1 block text-xs text-muted-foreground sm:mt-0">{description}</span>
        </div>
      ))}
    </div>
    <p className="mt-auto rounded-lg bg-muted p-3 text-xs leading-relaxed text-muted-foreground">
      Pin React and bippy, test production builds, and fail without breaking the app.
    </p>
  </div>
);

const RecapShowcase = () => (
  <div className="flex h-full flex-col gap-4">
    <ShowcaseHeader description="The small API map.">bippy in five lines</ShowcaseHeader>
    <div className="space-y-2 text-sm text-muted-foreground">
      {[
        ["import", "install the hook before React"],
        ["instrument", "subscribe to renderer events"],
        ["traverseRenderedFibers", "visit commit work"],
        ["getFiber", "go from host node to React"],
        ["traverseFiber", "walk the tree"],
      ].map(([method, description]) => (
        <div key={method} className="rounded-lg border border-border bg-background p-3">
          <code className="font-mono text-xs text-foreground">{method}</code>
          <p className="mt-1 text-xs">{description}</p>
        </div>
      ))}
    </div>
    <Button
      className="mt-auto"
      nativeButton={false}
      render={<a href="https://github.com/aidenybai/bippy#api-reference">API reference</a>}
    />
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

export const GuideShowcase = ({ activeSectionIndex }: GuideShowcaseProps) => {
  const ActiveShowcase = showcaseComponents[activeSectionIndex] ?? IntroShowcase;

  return (
    <ShowcaseFrame key={activeSectionIndex}>
      <ActiveShowcase />
    </ShowcaseFrame>
  );
};
