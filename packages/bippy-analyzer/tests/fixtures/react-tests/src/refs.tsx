import { useRef, useState } from "react";

export const RefInitialValueInRender = () => {
  const label = useRef<"ready" | "done">("ready");
  return <p>{label.current === "ready" ? "ready" : "done"}</p>;
};

export const RefWrittenInHandlerReadAfterUpdate = () => {
  const clicks = useRef(0);
  const [isOn, setIsOn] = useState(false);
  return (
    <div>
      <button
        onClick={() => {
          clicks.current = clicks.current + 1;
          setIsOn(!isOn);
        }}
      >
        click
      </button>
      <p>{clicks.current === 0 ? "zero" : clicks.current === 1 ? "one" : "more"}</p>
    </div>
  );
};

export const RefWriteWithoutUpdateDoesNotRender = () => {
  const clicks = useRef(0);
  return (
    <div>
      <button
        onClick={() => {
          clicks.current = clicks.current + 1;
        }}
      >
        click
      </button>
      <p>{clicks.current === 0 ? "zero" : "more"}</p>
    </div>
  );
};
