import { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";

const DetachedPortal = ({ children }: { children: React.ReactNode }) => {
  const [fragment, setFragment] = useState<DocumentFragment>();
  useLayoutEffect(() => {
    setFragment(new DocumentFragment());
  }, []);
  return fragment ? createPortal(<div>{children}</div>, fragment) : null;
};

const NodeFacts = () => {
  const text = new Text("hello");
  const comment = new Comment("note");
  const picture = new Image(8, 6);
  return (
    <dl>
      {text.data === "hello" && text.nodeType === 3 ? <dt>text</dt> : <dd>no text</dd>}
      {comment.nodeType === 8 ? <dt>comment</dt> : <dd>no comment</dd>}
      {picture.width === 8 && picture.tagName === "IMG" ? <dt>image</dt> : <dd>no image</dd>}
    </dl>
  );
};

const Timestamp = () => {
  const [sentAt] = useState(() => new Date().toLocaleTimeString());
  const stamp = new Date().toISOString();
  return (
    <p>
      {sentAt && <time>{sentAt}</time>}
      {stamp.length > 0 ? <b>stamped</b> : <i>blank</i>}
    </p>
  );
};

export default function HostNodeConstructors() {
  return (
    <section>
      <DetachedPortal>
        <span>hidden in a fragment</span>
      </DetachedPortal>
      <NodeFacts />
      <Timestamp />
    </section>
  );
}
