export default () => {
  let label = "initial";
  const inner = new Proxy(
    { marker: "target" },
    {
      marker: "handler",
      set(target, key, value, receiver) {
        label = `${receiver.marker}:${this.marker}:${value}`;
        return true;
      },
    },
  );
  const outer = new Proxy(inner, {
    get: (target, key) => (key === "marker" ? "outer" : target[key]),
  });
  outer.value = "new";
  return (
    <main>
      <span>Result:</span>
      {label}
    </main>
  );
};
