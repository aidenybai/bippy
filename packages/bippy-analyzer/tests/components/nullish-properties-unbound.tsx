export default () => {
  class Item {
    value = "ready";
    read() {
      return this.value;
    }
  }
  const read = new Item().read;
  let label = "returned";
  try {
    read();
  } catch {
    label = "caught";
  }
  return (
    <main>
      <span>Result:</span>
      {label}
    </main>
  );
};
