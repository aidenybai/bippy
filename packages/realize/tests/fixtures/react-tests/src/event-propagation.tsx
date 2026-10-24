import { useState } from "react";

type Status = "idle" | "clicked";

type Phase = "idle" | "capture" | "target" | "bubble" | "wrong";

export const ClickBubblesToParent = () => {
  const [inner, setInner] = useState<Status>("idle");
  const [outer, setOuter] = useState<Status>("idle");
  return (
    <div onClick={() => setOuter("clicked")}>
      <button onClick={() => setInner("clicked")}>target</button>
      <p>{inner === "clicked" ? "inner clicked" : "inner idle"}</p>
      <p>{outer === "clicked" ? "outer clicked" : "outer idle"}</p>
    </div>
  );
};

export const CaptureBeforeTargetBeforeBubble = () => {
  const [phase, setPhase] = useState<Phase>("idle");
  return (
    <div
      onClickCapture={() => setPhase((current) => (current === "idle" ? "capture" : "wrong"))}
      onClick={() => setPhase((current) => (current === "target" ? "bubble" : "wrong"))}
    >
      <button onClick={() => setPhase((current) => (current === "capture" ? "target" : "wrong"))}>
        target
      </button>
      <p>
        {phase === "idle"
          ? "idle"
          : phase === "capture"
            ? "capture"
            : phase === "target"
              ? "target"
              : phase === "bubble"
                ? "bubble"
                : "wrong"}
      </p>
    </div>
  );
};

export const StopPropagationInTarget = () => {
  const [inner, setInner] = useState<Status>("idle");
  const [outer, setOuter] = useState<Status>("idle");
  return (
    <div onClick={() => setOuter("clicked")}>
      <button
        onClick={(event) => {
          event.stopPropagation();
          setInner("clicked");
        }}
      >
        target
      </button>
      <p>{inner === "clicked" ? "inner clicked" : "inner idle"}</p>
      <p>{outer === "clicked" ? "outer clicked" : "outer idle"}</p>
    </div>
  );
};

export const StopPropagationInOuterCapture = () => {
  const [inner, setInner] = useState<Status>("idle");
  const [outer, setOuter] = useState<Status>("idle");
  return (
    <div
      onClickCapture={(event) => {
        event.stopPropagation();
        setOuter("clicked");
      }}
    >
      <button onClick={() => setInner("clicked")}>target</button>
      <p>{inner === "clicked" ? "inner clicked" : "inner idle"}</p>
      <p>{outer === "clicked" ? "outer clicked" : "outer idle"}</p>
    </div>
  );
};

export const ClickOnChildWithoutListener = () => {
  const [count, setCount] = useState(0);
  return (
    <div onClick={() => setCount((current) => current + 1)}>
      <span>label</span>
      <p>{count === 0 ? "none" : count === 1 ? "one" : "many"}</p>
    </div>
  );
};

export const SubmitButtonSubmitsForm = () => {
  const [isSent, setIsSent] = useState(false);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setIsSent(true);
      }}
    >
      <button type="submit">send</button>
      <p>{isSent ? "sent" : "draft"}</p>
    </form>
  );
};

export const SubmitButtonClickAndSubmit = () => {
  const [isClicked, setIsClicked] = useState(false);
  const [isSent, setIsSent] = useState(false);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setIsSent(true);
      }}
    >
      <button type="submit" onClick={() => setIsClicked(true)}>
        send
      </button>
      <p>{isClicked ? "clicked" : "untouched"}</p>
      <p>{isSent ? "sent" : "draft"}</p>
    </form>
  );
};

export const ButtonTypeButtonDoesNotSubmit = () => {
  const [isClicked, setIsClicked] = useState(false);
  const [isSent, setIsSent] = useState(false);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setIsSent(true);
      }}
    >
      <button type="button" onClick={() => setIsClicked(true)}>
        press
      </button>
      <p>{isClicked ? "clicked" : "untouched"}</p>
      <p>{isSent ? "sent" : "draft"}</p>
    </form>
  );
};
