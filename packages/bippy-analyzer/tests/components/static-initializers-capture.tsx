export default () => {
  let captured;
  let label = "returned";
  try {
    class Holder {
      static captured = (captured = this);
      static {
        if (Math.random() > 0.5) throw "block";
      }
      static later = "ready";
    }
  } catch {
    label = "caught";
  }
  return (
    <main>
      <span>Result:</span>
      {`${label}:${captured.later ?? "missing"}`}
    </main>
  );
};
