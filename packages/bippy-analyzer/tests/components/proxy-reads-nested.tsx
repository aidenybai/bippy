export default () => {
  const inner = new Proxy(
    { value: "target" },
    {
      marker: "handler",
      get(target, key, receiver) {
        return `${this.marker}:${receiver === outer ? "outer" : "inner"}`;
      },
    },
  );
  const outer = new Proxy(inner, {});
  return (
    <main>
      <span>Result:</span>
      {outer.value}
    </main>
  );
};
