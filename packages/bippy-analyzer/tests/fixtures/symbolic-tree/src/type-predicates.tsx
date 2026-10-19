import { useState } from "react";

type Kind = "fab" | "extendedFab" | "chip" | "button";
type FabKind = "fab" | "extendedFab";

const FAB_KINDS: readonly string[] = ["fab", "extendedFab"];

const isFab = (kind: Kind): kind is FabKind => FAB_KINDS.includes(kind);

const FabRow = ({ value }: { value: FabKind }) => <p>{value}</p>;

export const PartInspector = () => {
  const [kind, setKind] = useState<Kind>("button");
  const fab = isFab(kind);
  return (
    <div>
      <button onClick={() => setKind("fab")}>Make FAB</button>
      <button onClick={() => setKind("chip")}>Make chip</button>
      {fab ? <FabRow value={kind as FabKind} /> : <p>Not a FAB</p>}
    </div>
  );
};

type App = "claude" | "codex" | "openclaw";
type KnownApp = "claude" | "codex";

const KNOWN_APPS: ReadonlyArray<App> = ["claude", "codex"];

const UsageLink = ({ app }: { app: KnownApp }) => <a href={`/usage/${app}`}>{app}</a>;

export const AppMenu = ({ app }: { app: App }) => {
  const known = KNOWN_APPS.includes(app) ? (app as KnownApp) : null;
  const isPinned = ["claude", "openclaw"].includes(app);
  return (
    <nav>
      {known ? <UsageLink app={known} /> : null}
      {isPinned ? <b>Pinned</b> : null}
    </nav>
  );
};
