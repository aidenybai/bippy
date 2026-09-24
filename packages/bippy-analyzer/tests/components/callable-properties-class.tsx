export default () => {
  const evaluate = () => {
    class Holder {
      static {
        if (Math.random() > 0.5) this.value = "ready";
      }
    }
    return `${Holder.value ?? "missing"}:${"value" in Holder}:${Holder.hasOwnProperty("value")}`;
  };
  return (
    <main>
      <span>Result:</span>
      {evaluate()}
    </main>
  );
};
