export default () => {
  const target = {
    get value() {
      return this === proxy ? "proxy" : "target";
    },
  };
  const proxy = new Proxy(target, {});
  return (
    <main>
      <span>Result:</span>
      {proxy.value}
    </main>
  );
};
