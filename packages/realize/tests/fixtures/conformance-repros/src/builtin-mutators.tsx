import { createContext, useContext, useState } from "react";

export const ObjectAssign = () => {
  const [box, setBox] = useState({ level: 1, inner: { flag: false } });
  void setBox;
  return (
    <div>
      <button
        onClick={() => {
          Object.assign(box, { level: 2 });
        }}
      >
        go
      </button>
      {box.level}
    </div>
  );
};

export const InnerAssign = () => {
  const [box, setBox] = useState({ level: 1, inner: { flag: false } });
  void setBox;
  return (
    <div>
      <button
        onClick={() => {
          Object.assign(box.inner, { flag: true });
        }}
      >
        go
      </button>
      {box.inner.flag ? <i>on</i> : <i>off</i>}
    </div>
  );
};

export const ReflectSet = () => {
  const [box, setBox] = useState({ level: 1 });
  void setBox;
  return (
    <div>
      <button
        onClick={() => {
          Reflect.set(box, "level", 2);
        }}
      >
        go
      </button>
      {box.level}
    </div>
  );
};

export const PrototypeCall = () => {
  const [items, setItems] = useState<number[]>([]);
  void setItems;
  return (
    <div>
      <button
        onClick={() => {
          Array.prototype.push.call(items, 1);
        }}
      >
        go
      </button>
      {items.length}
    </div>
  );
};

export const CopyAssign = () => {
  const [box, setBox] = useState({ level: 1 });
  return (
    <div>
      <button onClick={() => setBox(Object.assign({}, box, { level: 2 }))}>go</button>
      {box.level}
    </div>
  );
};

const SharedContext = createContext({ level: 1 });

export const ContextWrite = () => {
  const shared = useContext(SharedContext);
  return (
    <div>
      <button
        onClick={() => {
          shared.level = 2;
        }}
      >
        go
      </button>
      {shared.level}
    </div>
  );
};
