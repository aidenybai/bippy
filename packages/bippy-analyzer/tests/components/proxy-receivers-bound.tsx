export default () => {
  let label = "initial";
  const other = {
    marker: "bound",
    write(next: string) {
      label = `${this.marker}:${next}`;
    },
  };
  const target = Object.defineProperty({}, "value", { set: other.write.bind(other) });
  const proxy = new Proxy(target, { get: () => "proxy" });
  proxy.value = "new";
  return (
    <main>
      <span>Result:</span>
      {label}
    </main>
  );
};
