export default () => {
  let label = "returned";
  const test = () => {
    throw Math.random() > 0.5 ? null : undefined;
  };
  try {
    for (; test();) {
      label = "body";
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
