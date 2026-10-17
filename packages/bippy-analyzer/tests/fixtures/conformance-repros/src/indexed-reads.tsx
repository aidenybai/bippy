type Provider = "openai" | "azure";

export const KeyLabel = ({ keys }: { keys: Record<string, Provider> }) => (
  <p>{keys["azure"] ? "Set by the server" : "Enter a key"}</p>
);

export const RangeLabel = ({
  min = 0,
  minLabel = min,
}: {
  min?: number;
  minLabel?: React.ReactNode;
}) => <p>{minLabel}</p>;
