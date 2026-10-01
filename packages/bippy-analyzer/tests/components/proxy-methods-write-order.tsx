export default () => {
  let trace = "";
  const target = { value: "old" };
  const proxy = new Proxy(target, {
    get set() {
      trace += "G";
      return 123;
    },
  });
  const key = () => {
    trace += "K";
    return "value";
  };
  const value = () => {
    trace += "R";
    return "new";
  };
  let label = "returned";
  try {
    proxy[key()] = value();
  } catch {
    label = "caught";
  }
  return (
    <main>
      <span>Result:</span>
      {`${label}:${trace}:${target.value}`}
    </main>
  );
};
