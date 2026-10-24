import { useState } from "react";

const touch = (target: object) => {
  Reflect.set(target, "touched", true);
};

export const SliceCopy = () => {
  const [box, setBox] = useState({ list: [{ done: false }], inner: { flag: false } });
  return (
    <button
      onClick={() => {
        const copy = box.list.slice();
        copy[0].done = true;
        setBox({ ...box });
      }}
    >
      {box.list.length}
    </button>
  );
};

export const ArrayFromCopy = () => {
  const [box, setBox] = useState({ list: [{ done: false }], inner: { flag: false } });
  return (
    <button
      onClick={() => {
        Array.from(box.list)[0].done = true;
        setBox({ ...box });
      }}
    >
      {box.list.length}
    </button>
  );
};

export const ObjectValuesCopy = () => {
  const [box, setBox] = useState({ list: [{ done: false }], inner: { flag: false } });
  return (
    <button
      onClick={() => {
        Object.values(box.list)[0].done = true;
        setBox({ ...box });
      }}
    >
      {box.list.length}
    </button>
  );
};

export const ObjectEntriesCopy = () => {
  const [box, setBox] = useState({ list: [{ done: false }], inner: { flag: false } });
  return (
    <button
      onClick={() => {
        const pairs = Object.entries(box);
        (pairs[1][1] as { flag: boolean }).flag = true;
        setBox({ ...box });
      }}
    >
      {box.list.length}
    </button>
  );
};

export const FlatCopy = () => {
  const [box, setBox] = useState({ list: [{ done: false }], inner: { flag: false } });
  return (
    <button
      onClick={() => {
        [box.list].flat()[0].done = true;
        setBox({ ...box });
      }}
    >
      {box.list.length}
    </button>
  );
};

export const WithCopy = () => {
  const [box, setBox] = useState({ list: [{ done: false }], inner: { flag: false } });
  return (
    <button
      onClick={() => {
        box.list.with(0, box.list[0])[0].done = true;
        setBox({ ...box });
      }}
    >
      {box.list.length}
    </button>
  );
};

export const ReversedSpread = () => {
  const [box, setBox] = useState({ list: [{ done: false }], inner: { flag: false } });
  return (
    <button
      onClick={() => {
        const rows = [...box.list].reverse();
        rows[0].done = true;
        setBox({ ...box });
      }}
    >
      {box.list.length}
    </button>
  );
};

export const SliceCopyInRender = () => {
  const [box, setBox] = useState({ list: [{ done: false }], inner: { flag: false } });
  if (box.list.length > 0) {
    const copy = box.list.slice();
    copy[0].done = true;
  }
  return <button onClick={() => setBox({ ...box })}>{box.list.length}</button>;
};

export const ArrayFromCopyInRender = () => {
  const [box, setBox] = useState({ list: [{ done: false }], inner: { flag: false } });
  if (box.list.length > 0) {
    Array.from(box.list)[0].done = true;
  }
  return <button onClick={() => setBox({ ...box })}>{box.list.length}</button>;
};

export const ObjectValuesCopyInRender = () => {
  const [box, setBox] = useState({ list: [{ done: false }], inner: { flag: false } });
  if (box.list.length > 0) {
    Object.values(box.list)[0].done = true;
  }
  return <button onClick={() => setBox({ ...box })}>{box.list.length}</button>;
};

export const ObjectEntriesCopyInRender = () => {
  const [box, setBox] = useState({ list: [{ done: false }], inner: { flag: false } });
  if (box.list.length > 0) {
    const pairs = Object.entries(box);
    (pairs[1][1] as { flag: boolean }).flag = true;
  }
  return <button onClick={() => setBox({ ...box })}>{box.list.length}</button>;
};

export const FlatCopyInRender = () => {
  const [box, setBox] = useState({ list: [{ done: false }], inner: { flag: false } });
  if (box.list.length > 0) {
    [box.list].flat()[0].done = true;
  }
  return <button onClick={() => setBox({ ...box })}>{box.list.length}</button>;
};

export const WithCopyInRender = () => {
  const [box, setBox] = useState({ list: [{ done: false }], inner: { flag: false } });
  if (box.list.length > 0) {
    box.list.with(0, box.list[0])[0].done = true;
  }
  return <button onClick={() => setBox({ ...box })}>{box.list.length}</button>;
};

export const ReversedSpreadInRender = () => {
  const [box, setBox] = useState({ list: [{ done: false }], inner: { flag: false } });
  if (box.list.length > 0) {
    const rows = [...box.list].reverse();
    rows[0].done = true;
  }
  return <button onClick={() => setBox({ ...box })}>{box.list.length}</button>;
};

export const HelperInRender = () => {
  const [box, setBox] = useState({ list: [{ done: false }], inner: { flag: false } });
  if (box.list.length > 0) {
    touch(box);
  }
  return <button onClick={() => setBox({ ...box })}>{box.list.length}</button>;
};

export const DestructuredInRender = () => {
  const [box, setBox] = useState({ list: [{ done: false }], inner: { flag: false } });
  if (box.list.length > 0) {
    const [first] = box.list;
    first.done = true;
  }
  return <button onClick={() => setBox({ ...box })}>{box.list.length}</button>;
};

export const ForOfInRender = () => {
  const [box, setBox] = useState({ list: [{ done: false }], inner: { flag: false } });
  if (box.list.length > 0) {
    for (const entry of box.list) entry.done = true;
  }
  return <button onClick={() => setBox({ ...box })}>{box.list.length}</button>;
};

export const NestedPatternInRender = () => {
  const [box, setBox] = useState({ list: [{ done: false }], inner: { flag: false } });
  if (box.list.length > 0) {
    const {
      list: [row],
    } = box;
    row.done = true;
  }
  return <button onClick={() => setBox({ ...box })}>{box.list.length}</button>;
};

export const SlicePushed = () => {
  const [box, setBox] = useState({ list: [{ done: false }], inner: { flag: false } });
  return (
    <button
      onClick={() => {
        const copy = box.list.slice();
        copy.push({ done: true });
        setBox({ ...box });
      }}
    >
      {box.list.length}
    </button>
  );
};

export const ArrayFromPushed = () => {
  const [box, setBox] = useState({ list: [{ done: false }], inner: { flag: false } });
  return (
    <button
      onClick={() => {
        const copy = Array.from(box.list);
        copy.push({ done: true });
        setBox({ ...box });
      }}
    >
      {box.list.length}
    </button>
  );
};

export const ReversedSpreadOnly = () => {
  const [box, setBox] = useState({ list: [{ done: false }], inner: { flag: false } });
  return (
    <button
      onClick={() => {
        const rows = [...box.list].reverse();
        rows.push({ done: true });
        setBox({ ...box });
      }}
    >
      {box.list.length}
    </button>
  );
};

export const ClonedElement = () => {
  const [box, setBox] = useState({ list: [{ done: false }], inner: { flag: false } });
  return (
    <button
      onClick={() => {
        structuredClone(box).list[0].done = true;
        setBox({ ...box });
      }}
    >
      {box.list.length}
    </button>
  );
};
