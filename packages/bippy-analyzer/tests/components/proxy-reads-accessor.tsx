export default () => {
  let trace = "";
  const proxy = new Proxy(
    { value: "target" },
    {
      get get() {
        trace += "G";
        return () => {
          trace += "T";
          return "ready";
        };
      },
    },
  );
  proxy.value;
  return (
    <main>
      <span>Result:</span>
      {trace || "empty"}
    </main>
  );
};
