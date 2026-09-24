export default () => {
  const other = {
    marker: "bound",
    read() {
      return this.marker;
    },
  };
  const proxy = new Proxy({}, { get: other.read.bind(other) });
  return (
    <main>
      <span>Result:</span>
      {proxy.value}
    </main>
  );
};
