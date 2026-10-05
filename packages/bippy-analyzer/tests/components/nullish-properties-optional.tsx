export default () => {
  const target = null;
  let trace = "";
  const getKey = () => {
    trace += "K";
    return "value";
  };
  const getValue = () => {
    trace += "A";
    return 1;
  };
  const value = target?.[getKey()]?.(getValue());
  return (
    <main>
      <span>Result:</span>
      {`${String(value)}:${trace}`}
    </main>
  );
};
