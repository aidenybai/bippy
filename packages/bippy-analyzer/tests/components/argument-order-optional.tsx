export default () => {
  const isPresent = Math.random() > 0.5;
  let calls = 0;
  const consume = (value: string) => value;
  const callee = isPresent ? consume : undefined;
  const getValue = () => {
    calls++;
    return "value";
  };
  const result = callee?.(getValue());
  return (
    <main>
      <span>Result:</span>
      {`${isPresent ? "present" : "missing"}:${calls}:${result ?? "none"}`}
    </main>
  );
};
