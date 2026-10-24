export const Badge = ({ tone }) => <span>{tone === "warning" ? "!" : "i"}</span>;

export const BadgeRow = () => <Badge tone="warning" />;
