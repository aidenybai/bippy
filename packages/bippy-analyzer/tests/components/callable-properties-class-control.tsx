export default () => {
  class Holder {
    static value = "ready";
  }
  return (
    <main>
      <span>Result:</span>
      {`${Holder.value}:${"value" in Holder}:${Holder.hasOwnProperty("value")}`}
    </main>
  );
};
