export default () => {
  const data = { value: 0 };
  let proxy = new Proxy(data, {});
  const original = proxy;
  proxy.value = 1;
  return (
    <main>
      <span>Result:</span>
      {`${proxy === original}:${data.value}`}
    </main>
  );
};
