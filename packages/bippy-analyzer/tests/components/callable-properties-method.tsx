export default () => {
  class Holder {
    method() {}
  }
  if (Math.random() > 0.5) Holder.prototype.method.value = "ready";
  return (
    <main>
      <span>Result:</span>
      {`${Holder.prototype.method.value ?? "missing"}:${Holder.prototype.method.hasOwnProperty("value")}`}
    </main>
  );
};
