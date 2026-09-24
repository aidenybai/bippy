export default () => {
  let trace = "initial";
  let calls = 0;
  const target = {
    marker: "target",
    set value(next: string) {
      calls++;
      trace = this.marker;
      throw new Error(next);
    },
  };
  const proxy = new Proxy(target, {
    get: (innerTarget, key) => (key === "marker" ? "proxy" : innerTarget[key]),
  });
  let label = "returned";
  try {
    proxy.value = "new";
    calls++;
  } catch {
    label = "caught";
  }
  return (
    <main>
      <span>Result:</span>
      {`${label}:${trace}:${calls}`}
    </main>
  );
};
