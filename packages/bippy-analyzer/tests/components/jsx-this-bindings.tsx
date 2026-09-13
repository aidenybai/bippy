const FirstLeaf = () => <span>first receiver</span>;
const SecondLeaf = () => <strong>second receiver</strong>;

const firstOwner = {
  Leaf: FirstLeaf,
  render() {
    return <this.Leaf />;
  },
};

const secondOwner = {
  Leaf: SecondLeaf,
  render: firstOwner.render,
};

const JsxThisBindings = () => (
  <main>
    {firstOwner.render()}
    {secondOwner.render()}
  </main>
);

export const isExact = true;

export default JsxThisBindings;
