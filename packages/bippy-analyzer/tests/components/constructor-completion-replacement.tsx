export default () => {
  class Item {
    value = "old";
    constructor() {
      return { value: "new" };
    }
  }
  const instance = new Item();
  return (
    <main>
      <span>Result:</span>
      {instance.value}
    </main>
  );
};
