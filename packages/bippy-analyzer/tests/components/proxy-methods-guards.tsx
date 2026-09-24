export default () => {
  let trace = "";
  const proxy = new Proxy(
    {},
    {
      get get() {
        trace += "G";
        return Math.random() > 0.5
          ? 123
          : () => {
              trace += "T";
              return "ready";
            };
      },
    },
  );
  let label = "returned";
  try {
    proxy.value;
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
