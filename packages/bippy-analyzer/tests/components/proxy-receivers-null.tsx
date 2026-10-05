export default () => {
  let label = "initial";
  const target = {
    marker: "target",
    set value(next: string) {
      label = `${this.marker}:${next}`;
    },
  };
  const proxy = new Proxy(target, {
    set: null,
    get: (innerTarget, key) => (key === "marker" ? "proxy" : innerTarget[key]),
  });
  proxy.value = "new";
  return (
    <main>
      <span>Result:</span>
      {label}
    </main>
  );
};
