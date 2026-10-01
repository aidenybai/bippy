export default () => {
  let label = "initial";
  let proxy: object;
  const target = {
    set value(next: string) {
      label = this === proxy ? "proxy" : "target";
    },
  };
  proxy = new Proxy(target, {});
  proxy.value = "new";
  return (
    <main>
      <span>Result:</span>
      {label}
    </main>
  );
};
