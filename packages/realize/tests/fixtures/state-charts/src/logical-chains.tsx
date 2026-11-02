declare const isEnabled: (feature: string) => boolean;

export const FeatureBadge = () => {
  const hasAnyFeature = isEnabled("search") || isEnabled("sync") || isEnabled("share");
  const isFullSync = isEnabled("sync") && isEnabled("offline");
  return (
    <p>
      {hasAnyFeature ? "Features on" : "Features off"}
      {isFullSync ? "Full sync" : null}
    </p>
  );
};
