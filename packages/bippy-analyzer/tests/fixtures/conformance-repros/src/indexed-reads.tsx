type Provider = "openai" | "azure";

export const KeyLabel = ({ keys }: { keys: Record<string, Provider> }) => (
  <p>{keys["azure"] ? "Set by the server" : "Enter a key"}</p>
);
