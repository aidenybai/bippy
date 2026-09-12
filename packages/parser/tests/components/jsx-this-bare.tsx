const Leaf = () => <span>bare receiver</span>;

const owner = {
  render(this: typeof Leaf) {
    return <this />;
  },
};

const JsxThisBare = () => owner.render.call(Leaf);

export const isExact = true;

export default JsxThisBare;
