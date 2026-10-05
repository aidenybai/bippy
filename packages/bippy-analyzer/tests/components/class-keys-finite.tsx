export default () => {
  const key = Math.random() > 0.5 ? "first" : "second";
  class Holder {
    static [key] = "ready";
  }
  return (
    <main>
      <span>Result:</span>
      {`${Holder.first ?? "absent"}:${Holder.second ?? "absent"}`}
    </main>
  );
};
