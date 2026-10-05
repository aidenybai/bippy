export default () => {
  let label = "initial";
  const handler = {
    set() {
      label = this === handler ? "handler" : "other";
      return true;
    },
  };
  const target = new Proxy({ value: "old" }, handler);
  target.value = "new";
  return (
    <main>
      <span>Result:</span>
      {label}
    </main>
  );
};
