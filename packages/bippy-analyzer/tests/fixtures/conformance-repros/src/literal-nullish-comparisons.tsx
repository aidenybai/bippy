export const ExplicitFalse = () => {
  const shouldRestore = ({ restore = true }: { restore?: boolean } = {}) => restore;
  return <div>{shouldRestore({ restore: false }) ? <i>restore</i> : <i>keep</i>}</div>;
};

export const ArrayDefault = () => {
  const count = (items: string[] = ["a"]) => items.length;
  return <div>{count([]) === 0 ? <i>empty</i> : <i>full</i>}</div>;
};

export const CallbackDefault = () => {
  const label = (format: (value: number) => string = String) => format(1);
  return <div>{label(() => "one") === "one" ? <i>custom</i> : <i>default</i>}</div>;
};
