export default () => {
  const parent = () => {
    throw "parent";
  };
  let Selected = class {
    static label = "old";
  };
  let label = "returned";
  try {
    Selected = class extends parent() {
      static label = "new";
    };
  } catch {
    label = "caught";
  }
  return (
    <main>
      <span>Result:</span>
      {`${label}:${Selected.label}`}
    </main>
  );
};
