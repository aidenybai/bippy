import { Fragment } from "react";

const Pair = () => (
  <>
    <dt>term</dt>
    <dd>definition</dd>
  </>
);

const Keyed = () => (
  <Fragment key="k">
    <li>keyed fragment child</li>
  </Fragment>
);

const NestedArrays = () => [<i key="a">a</i>, [<b key="b">b</b>, <u key="c">c</u>], "text"];

export default function Fragments() {
  return (
    <>
      <dl>
        <Pair />
        <>
          <dt>inline</dt>
          <dd>fragment</dd>
        </>
      </dl>
      <ul>
        <Keyed />
      </ul>
      <p>
        <NestedArrays />
      </p>
      <div>
        <span>first</span>
        <>
          <span>nested fragment</span>
        </>
      </div>
    </>
  );
}
