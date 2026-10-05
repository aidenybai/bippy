export default () => {
  let trace = "";
  let label = "returned";
  try {
    class Holder {
      static {
        try {
          trace += "B";
          throw null;
        } finally {
          trace += "F";
        }
      }
      static later = (trace += "L");
    }
  } catch (error) {
    label = error === null ? "null" : "other";
  }
  return (
    <main>
      <span>Result:</span>
      {`${label}:${trace}`}
    </main>
  );
};
