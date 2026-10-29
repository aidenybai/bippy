type AppId = "claude" | "codex" | "openclaw";

declare function isSupported(app: AppId): boolean;

export const UsageLink = ({ app }: { app: AppId }) => {
  const supported = isSupported(app) ? app : null;
  return (
    <p>
      {app === "openclaw" ? <b>open</b> : null}
      {supported ?? "none"}
    </p>
  );
};
