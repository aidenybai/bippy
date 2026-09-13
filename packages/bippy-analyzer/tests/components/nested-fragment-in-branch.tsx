const hasCanvas = () => document.createElement("canvas").getContext("2d") !== null;

const Layout = () => (
  <>
    {hasCanvas() ? (
      <>
        <section>canvas</section>
        <img alt="" />
      </>
    ) : (
      <>
        <p>no canvas</p>
        <img alt="" />
      </>
    )}
  </>
);

export default function NestedFragmentInBranch() {
  return (
    <main>
      <Layout />
    </main>
  );
}

export const isPartial = true;
