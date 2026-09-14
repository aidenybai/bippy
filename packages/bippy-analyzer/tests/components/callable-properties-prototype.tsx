export default () => {
  class Holder {}
  if (Math.random() > 0.5) Holder.prototype.value = "ready";
  return (
    <main>
      <span>Result:</span>
      {`${Holder.prototype.value ?? "missing"}:${Holder.prototype.hasOwnProperty("value")}`}
    </main>
  );
};
