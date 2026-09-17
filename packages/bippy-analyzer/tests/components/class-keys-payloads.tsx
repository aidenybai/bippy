export default () => {
  const key = () => {
    throw Math.random() > 0.5 ? null : undefined;
  };
  let label = "returned";
  try {
    class Holder {
      [key()]() {}
    }
  } catch (error) {
    label = error === null ? "null" : error === undefined ? "undefined" : "other";
  }
  return (
    <main>
      <span>Result:</span>
      {label}
    </main>
  );
};
