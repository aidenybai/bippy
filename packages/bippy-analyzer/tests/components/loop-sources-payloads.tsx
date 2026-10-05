export default () => {
  let label = "returned";
  const items = () => {
    throw Math.random() > 0.5 ? null : undefined;
  };
  try {
    for (const item of items()) {
      label = String(item);
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
