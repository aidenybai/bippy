// @ts-nocheck
import { useState } from "react";

export const LostUpdate = () => {
  const [items, setItems] = useState<string[]>([]);
  const add = () => {
    items.push("next");
    setItems(items);
  };
  return <button onClick={add}>{items.length}</button>;
};

export const CopyAfterPush = () => {
  const [items, setItems] = useState<string[]>([]);
  const add = () => {
    items.push("next");
    setItems([...items]);
  };
  return (
    <div>
      <button onClick={add}>Add</button>
      {items.length === 0 ? <p>Empty</p> : <p>Some</p>}
    </div>
  );
};

export const PushWithoutSet = () => {
  const [items] = useState<string[]>([]);
  return <button onClick={() => items.push("next")}>{items.length}</button>;
};

export const PushTwice = () => {
  const [items, setItems] = useState<string[]>([]);
  const add = () => {
    items.push("first");
    items.push("second");
    setItems([...items]);
  };
  return <button onClick={add}>{items.length}</button>;
};

export const SortProp = ({ items }: { items: string[] }) => {
  items.sort();
  return <p>{items.length}</p>;
};

export const RenderMutation = () => {
  const [items] = useState<string[]>([]);
  items.push("render");
  return <p>{items.length}</p>;
};

export const CopyWithinHandler = () => {
  const [items, setItems] = useState<string[]>([]);
  const shift = () => {
    items.copyWithin(0, 1);
    setItems([...items]);
  };
  return <button onClick={shift}>{items.length}</button>;
};

export const MapStateSet = () => {
  const [lookup, setLookup] = useState(() => new Map<string, number>());
  const add = () => {
    lookup.set("key", 1);
    setLookup(new Map(lookup));
  };
  return <button onClick={add}>{lookup.size}</button>;
};

export const SortInHandler = () => {
  const [items, setItems] = useState<string[]>([]);
  const sort = () => {
    items.sort();
    setItems(items);
  };
  return <button onClick={sort}>{items.length}</button>;
};

export const NestedField = () => {
  const [form, setForm] = useState({ tags: [] as string[] });
  const add = () => {
    form.tags.push("next");
    setForm({ ...form });
  };
  return <button onClick={add}>{form.tags.length}</button>;
};

export const SetAdd = () => {
  const [tags, setTags] = useState(() => new Set<string>());
  const add = () => {
    tags.add("next");
    setTags(tags);
  };
  return <button onClick={add}>{tags.size}</button>;
};

export const PropSortInHandler = ({ items }: { items: string[] }) => (
  <button onClick={() => items.reverse()}>{items.length}</button>
);

export const SortPropsMember = (props: { items: string[] }) => {
  props.items.sort();
  return <p>{props.items.length}</p>;
};
