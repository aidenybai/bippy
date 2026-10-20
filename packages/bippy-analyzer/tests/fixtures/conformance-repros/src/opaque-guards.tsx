const KNOWN_APPS = ["claude", "codex"] as const;
type KnownApp = (typeof KNOWN_APPS)[number];
type AppId = "claude" | "codex" | "openclaw";

export const UsageLink = ({ app }: { app: AppId }) => {
  const known = (KNOWN_APPS as ReadonlyArray<string>).includes(app) ? (app as KnownApp) : null;
  return (
    <p>
      {app === "openclaw" ? <b>open</b> : null}
      {known ?? "none"}
    </p>
  );
};

export const OpenLink = ({ app }: { app: AppId }) => {
  const known = app === "openclaw" ? (app as KnownApp) : null;
  return <p>{known ?? "none"}</p>;
};
