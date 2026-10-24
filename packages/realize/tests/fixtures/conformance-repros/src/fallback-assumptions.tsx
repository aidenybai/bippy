export const NullishLabel = ({ label }: { label?: string }) => {
  const text = label ?? "Untitled";
  return <div>{text === "Untitled" ? <i>none</i> : <b>{text}</b>}</div>;
};

export const TernaryLabel = ({ label }: { label?: string }) => {
  const text = label != null ? label : "Untitled";
  return <div>{text === "Untitled" ? <i>none</i> : <b>{text}</b>}</div>;
};
