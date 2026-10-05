export default () => {
  const parent = () => {
    throw Math.random() > 0.5 ? null : undefined;
  };
  let label = "returned";
  try {
    class Child extends parent() {}
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
