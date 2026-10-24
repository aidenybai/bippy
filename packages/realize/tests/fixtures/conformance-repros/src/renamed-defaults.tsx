interface BadgeProps {
  tone?: "plain" | "loud";
  label: string;
}

export const Badge = ({ tone: shade = "plain", label }: BadgeProps) =>
  shade === "loud" ? <strong>{label}</strong> : <span>{label}</span>;

interface PanelProps {
  layout?: { dense: boolean };
}

export const Panel = ({ layout: { dense } = { dense: false } }: PanelProps) =>
  dense ? <ul className="dense" /> : <ul />;
