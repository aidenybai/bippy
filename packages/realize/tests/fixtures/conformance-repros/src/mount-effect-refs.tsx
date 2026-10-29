import { useEffect, useLayoutEffect, useRef, useState } from "react";

export const MeasuredBox = () => {
  const boxRef = useRef<HTMLDivElement>(null);
  const [isMeasured, setIsMeasured] = useState(false);
  useLayoutEffect(() => {
    if (boxRef.current) setIsMeasured(true);
  }, []);
  return <div ref={boxRef}>{isMeasured ? "measured" : "pending"}</div>;
};

export const PortalHost = () => {
  const hostRef = useRef<HTMLDivElement>(null);
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    setContainer(hostRef.current);
  }, []);
  return <div ref={hostRef}>{container ? "ready" : "waiting"}</div>;
};

export const UnattachedRef = () => {
  const countRef = useRef(0);
  const [isSeen, setIsSeen] = useState(false);
  useEffect(() => {
    if (countRef.current > 0) setIsSeen(true);
  }, []);
  return <p>{isSeen ? "seen" : "unseen"}</p>;
};

export const CallbackRefNode = () => {
  const nodeRef = useRef<HTMLElement | null>(null);
  const [hasNode, setHasNode] = useState(false);
  useEffect(() => {
    if (nodeRef.current) setHasNode(true);
  }, []);
  return (
    <section
      ref={(node) => {
        nodeRef.current = node;
      }}
    >
      {hasNode ? "attached" : "detached"}
    </section>
  );
};
