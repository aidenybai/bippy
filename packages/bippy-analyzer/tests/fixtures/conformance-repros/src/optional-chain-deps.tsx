import { useMemo, type ReactNode } from "react";

interface Snapshot {
  header?: string;
  footer?: string;
}

interface SlotProps {
  snapshot?: Snapshot;
  renderHeader?: () => ReactNode;
}

export const OptionalDependency = ({ snapshot, renderHeader }: SlotProps) => {
  const header = useMemo(
    () => (renderHeader != null && snapshot?.header != null ? <b>{snapshot.header}</b> : null),
    [renderHeader, snapshot?.header],
  );
  return <>{header}</>;
};

export const StaleSibling = ({ snapshot }: SlotProps) => {
  const footer = useMemo(
    () => (snapshot?.footer != null ? <i>{snapshot.footer}</i> : null),
    [snapshot?.header],
  );
  return <>{footer}</>;
};

export const MappedChain = ({ snapshot }: { snapshot?: { items?: string[] } }) => {
  const rows = useMemo(
    () => snapshot?.items?.map((item) => <li key={item}>{item}</li>),
    [snapshot?.items],
  );
  return <ul>{rows}</ul>;
};
