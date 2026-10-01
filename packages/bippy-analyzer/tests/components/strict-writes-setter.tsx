export default () => {
  let label = "initial";
  const target = {
    set value(next) {
      label = next;
      return false;
    },
  };
  const proxy = new Proxy(target, {});
  proxy.value = "new";
  return (
    <main>
      <span>Result:</span>
      {label}
    </main>
  );
};
