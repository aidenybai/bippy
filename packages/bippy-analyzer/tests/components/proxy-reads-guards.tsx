export default () => {
  let trace = "";
  const proxy = new Proxy(
    {},
    {
      get get() {
        trace += "G";
        if (Math.random() > 0.5) throw new Error("trap");
        return () => {
          trace += "T";
          return () => {
            trace += "C";
          };
        };
      },
    },
  );
  const key = () => {
    trace += "K";
    return "run";
  };
  const argument = () => {
    trace += "A";
    return "value";
  };
  let label = "returned";
  try {
    proxy[key()](argument());
  } catch {
    label = "caught";
  }
  return (
    <main>
      <span>Result:</span>
      {`${label}:${trace}`}
    </main>
  );
};
