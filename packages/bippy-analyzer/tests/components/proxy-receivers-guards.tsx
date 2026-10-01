export default () => {
  let trace = "initial";
  const target =
    Math.random() > 0.5
      ? {
          marker: "first",
          set value(next: string) {
            trace = `A:${this.marker}`;
            throw new Error(next);
          },
        }
      : {
          marker: "second",
          set value(next: string) {
            trace = `B:${this.marker}`;
          },
        };
  const proxy = new Proxy(target, {
    get: (innerTarget, key) => (key === "marker" ? "proxy" : innerTarget[key]),
  });
  let label = "returned";
  try {
    proxy.value = "new";
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
