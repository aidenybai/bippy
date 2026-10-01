export default () => {
  class Target {
    read() {
      return this === undefined ? "unbound" : "bound";
    }
  }
  const target = new Target();
  return (
    <main>
      <span>Result:</span>
      {(0, target.read)()}
    </main>
  );
};
