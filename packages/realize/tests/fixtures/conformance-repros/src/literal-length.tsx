export const EmptyLength = ({ input }: { input?: string }) => {
  const text = input ?? "";
  return <div>{text.length > 0 ? <b>{text}</b> : <i>empty</i>}</div>;
};

export const FixedLength = ({ isWide }: { isWide: boolean }) => {
  const label = isWide ? "wide" : "";
  return <div>{label.length === 4 ? <b>{label}</b> : <i>narrow</i>}</div>;
};
