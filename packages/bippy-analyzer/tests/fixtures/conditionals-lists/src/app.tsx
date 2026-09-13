import { Fragment } from "react";

interface Item {
  id: number;
  label: string;
  hidden?: boolean;
}

const ITEMS: Item[] = [
  { id: 1, label: "one" },
  { id: 2, label: "two", hidden: true },
  { id: 3, label: "three" },
];

const EMPTY: Item[] = [];

const FIRST_FRUIT = "apple";
const SECOND_FRUIT = "banana";
const NUMERIC_STRING = "10";
const LIMIT = 9;

const Tile = ({ label }: { label: string }) => <div className="tile">{label}</div>;

const Empty = () => <p>nothing</p>;

export const App = ({ mode }: { mode: "grid" | "list" }) => {
  const visible = ITEMS.filter((item) => !item.hidden);
  const doubled = visible.flatMap((item) => [item, item]);
  const labels = visible.map((item) => item.label);
  return (
    <>
      {mode === "grid" ? <section className="grid" /> : <section className="list" />}
      {mode === "list" && <hr />}
      {labels.length > 0 ? labels.map((label) => <Tile key={label} label={label} />) : <Empty />}
      {EMPTY.length === 0 ? (
        <Empty />
      ) : (
        EMPTY.map((item) => <Tile key={item.id} label={item.label} />)
      )}
      {doubled.map((item, index) => (
        <Fragment key={`${item.id}-${index}`}>
          <dt>{item.id}</dt>
          <dd>{item.label}</dd>
        </Fragment>
      ))}
      {null}
      {false}
      {undefined}
      {0}
      {[<i key="a" />, [<u key="b" />, <s key="c" />]]}
      {Array.from({ length: 2 }, (_, index) => (
        <var key={index}>{index}</var>
      ))}
      {visible.length}
      {mode ?? "fallback"}
      {FIRST_FRUIT < SECOND_FRUIT ? <b>sorted</b> : <b>unsorted</b>}
      {NUMERIC_STRING < LIMIT ? <em>numeric</em> : <em>lexical</em>}
    </>
  );
};
