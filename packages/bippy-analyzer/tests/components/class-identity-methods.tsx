export default () => {
  class Item {
    read() {
      return this;
    }
    arrow = () => this;
  }
  const first = new Item();
  const second = new Item();
  return (
    <main>
      <span>Result:</span>
      {`${first.read === second.read}:${first.arrow === second.arrow}:${first.read() === first}`}
    </main>
  );
};
