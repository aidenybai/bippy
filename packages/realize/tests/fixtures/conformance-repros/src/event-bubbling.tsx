import { useRef, useState } from "react";
import type { Ref } from "react";

export const Bubbling = () => {
  const [inner, setInner] = useState(false);
  const [outer, setOuter] = useState(false);
  return (
    <div>
      <section onClick={() => setOuter(true)}>
        <button onClick={() => setInner(true)}>go</button>
      </section>
      {inner && outer ? (
        <i>both</i>
      ) : inner ? (
        <i>inneronly</i>
      ) : outer ? (
        <i>outeronly</i>
      ) : (
        <i>none</i>
      )}
    </div>
  );
};

export const Stopped = () => {
  const [inner, setInner] = useState(false);
  const [outer, setOuter] = useState(false);
  return (
    <div>
      <section onClick={() => setOuter(true)}>
        <button
          onClick={(event) => {
            event.stopPropagation();
            setInner(true);
          }}
        >
          go
        </button>
      </section>
      {inner && outer ? (
        <i>both</i>
      ) : inner ? (
        <i>inneronly</i>
      ) : outer ? (
        <i>outeronly</i>
      ) : (
        <i>none</i>
      )}
    </div>
  );
};

export const Captured = () => {
  const [order, setOrder] = useState("");
  return (
    <div>
      <section onClickCapture={() => setOrder("outer")}>
        <button onClick={() => setOrder((current) => current + "-inner")}>go</button>
      </section>
      {order === "outer-inner" ? <i>ordered</i> : order === "" ? <i>none</i> : <i>Z1</i>}
    </div>
  );
};

export const StoppedByAncestor = () => {
  const [isOn, setIsOn] = useState(true);
  const [count, setCount] = useState(0);
  return (
    <section onClick={() => setIsOn(true)}>
      <div
        onClick={(event) => {
          setCount(2);
          event.stopPropagation();
        }}
      >
        <button onClick={() => setIsOn(false)}>go</button>
      </div>
      {isOn ? <i>on</i> : <i>off</i>}
      {count === 2 ? <b>two</b> : <b>zero</b>}
    </section>
  );
};

export const SubmitButton = () => {
  const [isClicked, setIsClicked] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setIsSubmitted(true);
      }}
    >
      <button type="submit" onClick={() => setIsClicked(true)}>
        send
      </button>
      <button type="button" onClick={() => setIsClicked(false)}>
        reset
      </button>
      <button
        onClick={(event) => {
          event.preventDefault();
          setIsClicked(true);
        }}
      >
        hold
      </button>
      {isClicked && isSubmitted ? <i>both</i> : isSubmitted ? <i>submitted</i> : <i>none</i>}
    </form>
  );
};

export const MaybeStopped = () => {
  const [isLocked, setIsLocked] = useState(false);
  const [outer, setOuter] = useState(0);
  return (
    <div>
      <section onClick={() => setOuter((current) => current + 1)}>
        <button
          onClick={(event) => {
            if (isLocked) event.stopPropagation();
            setIsLocked(true);
          }}
        >
          go
        </button>
      </section>
      {outer > 0 ? <i>reached</i> : <i>none</i>}
    </div>
  );
};

export const MaybeStoppedByCapture = () => {
  const [count, setCount] = useState(0);
  return (
    <section
      onClickCapture={(event) => {
        if (count >= 2) event.stopPropagation();
      }}
    >
      <button onClick={() => setCount(count + 1)}>go</button>
      {count >= 2 ? <i>many</i> : <i>few</i>}
    </section>
  );
};

export const MaybePrevented = () => {
  const [isHeld, setIsHeld] = useState(true);
  const [isSubmitted, setIsSubmitted] = useState(false);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setIsSubmitted(true);
      }}
    >
      <button
        onClick={(event) => {
          if (isHeld) event.preventDefault();
          setIsHeld(false);
        }}
      >
        send
      </button>
      {isSubmitted ? <i>submitted</i> : <i>none</i>}
    </form>
  );
};

export const SubmitByType = () => {
  const [isPrimary, setIsPrimary] = useState(true);
  const [isSent, setIsSent] = useState(false);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setIsSent(true);
      }}
    >
      <button type={isPrimary ? "submit" : "button"} onClick={() => setIsPrimary(false)}>
        send
      </button>
      <button type={undefined} onClick={() => setIsPrimary(true)}>
        again
      </button>
      {isSent ? <i>sent</i> : <i>draft</i>}
    </form>
  );
};

export const EnteredTogether = () => {
  const [isInner, setIsInner] = useState(false);
  const [isOuter, setIsOuter] = useState(false);
  return (
    <div onMouseEnter={() => setIsOuter(true)} onMouseLeave={() => setIsOuter(false)}>
      <button onMouseEnter={() => setIsInner(true)} onMouseLeave={() => setIsInner(false)}>
        go
      </button>
      {isInner && isOuter ? <i>both</i> : <i>apart</i>}
    </div>
  );
};

export const InputThenChange = () => {
  const [isInput, setIsInput] = useState(false);
  const [isChanged, setIsChanged] = useState(false);
  return (
    <div onInput={() => setIsInput(true)}>
      <input aria-label="field" onChange={() => setIsChanged(true)} />
      {isInput && isChanged ? <i>both</i> : <i>apart</i>}
    </div>
  );
};

export const LabelAroundCheckbox = () => {
  const [labelClicks, setLabelClicks] = useState(0);
  const [isOn, setIsOn] = useState(false);
  return (
    <label onClick={() => setLabelClicks((current) => current + 1)}>
      <input type="checkbox" checked={isOn} onChange={(event) => setIsOn(event.target.checked)} />
      tick
      {labelClicks === 2 && isOn ? <i>twice</i> : <i>other</i>}
    </label>
  );
};

export const LabelForField = () => {
  const [isLabelClicked, setIsLabelClicked] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  return (
    <div>
      <label htmlFor="name" onClick={() => setIsLabelClicked(true)}>
        name
      </label>
      <input id="name" onFocus={() => setIsFocused(true)} />
      {isLabelClicked && isFocused ? <i>both</i> : <i>apart</i>}
    </div>
  );
};

export const FormDefaults = () => {
  const [clicks, setClicks] = useState(0);
  const [isReset, setIsReset] = useState(false);
  const [isSent, setIsSent] = useState(false);
  const [isToggled, setIsToggled] = useState(false);
  return (
    <div>
      <form onReset={() => setIsReset(true)}>
        <button type="reset" onClick={() => setClicks(1)}>
          clear
        </button>
      </form>
      <form
        id="remote"
        onSubmit={(event) => {
          event.preventDefault();
          setIsSent(true);
        }}
      />
      <button form="remote" onClick={() => setClicks(2)}>
        send
      </button>
      <details onToggle={() => setIsToggled(true)}>
        <summary onClick={() => setClicks(3)}>more</summary>
      </details>
      {clicks > 0 && (isReset || isSent || isToggled) ? <i>done</i> : <i>open</i>}
    </div>
  );
};

export const NestedActivators = () => {
  const [clicks, setClicks] = useState(0);
  const [isSent, setIsSent] = useState(false);
  const [isOn, setIsOn] = useState(false);
  return (
    <div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setIsSent(true);
        }}
      >
        <button>
          <span onClick={() => setClicks(1)}>send</span>
        </button>
      </form>
      <label>
        <span onClick={() => setClicks(2)}>tick</span>
        <input type="checkbox" checked={isOn} onChange={(event) => setIsOn(event.target.checked)} />
      </label>
      {clicks > 0 && (isSent || isOn) ? <i>done</i> : <i>open</i>}
    </div>
  );
};

export const DispatchedFromHandlers = () => {
  const [clicks, setClicks] = useState(0);
  const [isFocused, setIsFocused] = useState(false);
  const [isReset, setIsReset] = useState(false);
  const fieldRef = useRef<HTMLInputElement>(null);
  return (
    <div>
      <input ref={fieldRef} aria-label="field" onFocus={() => setIsFocused(true)} />
      <button
        type="button"
        onClick={() => {
          setClicks(1);
          fieldRef.current?.focus();
        }}
      >
        go
      </button>
      <form
        onReset={() => setIsReset(true)}
        onSubmit={(event) => {
          event.preventDefault();
          setClicks(2);
          event.currentTarget.reset();
        }}
      >
        <button>send</button>
      </form>
      {clicks > 0 && (isFocused || isReset) ? <i>done</i> : <i>open</i>}
    </div>
  );
};

export const AutoFocused = () => {
  const [isFocused, setIsFocused] = useState(false);
  return (
    <div>
      <input autoFocus aria-label="field" onFocus={() => setIsFocused(true)} />
      {isFocused ? <i>focused</i> : <i>idle</i>}
    </div>
  );
};

const FocusField = ({ ref, onFocus }: { ref: Ref<HTMLInputElement>; onFocus: () => void }) => (
  <input ref={ref} aria-label="field" onFocus={onFocus} />
);

export const FocusThroughChild = () => {
  const [clicks, setClicks] = useState(0);
  const [isFocused, setIsFocused] = useState(false);
  const fieldRef = useRef<HTMLInputElement>(null);
  return (
    <div>
      <FocusField ref={fieldRef} onFocus={() => setIsFocused(true)} />
      <button
        type="button"
        onClick={() => {
          setClicks(1);
          fieldRef.current?.focus();
        }}
      >
        go
      </button>
      {clicks > 0 && isFocused ? <i>done</i> : <i>open</i>}
    </div>
  );
};

export const ClickThenFormAction = () => {
  const [clicks, setClicks] = useState(0);
  const [isSaved, setIsSaved] = useState(false);
  const [isAlternate, setIsAlternate] = useState(false);
  return (
    <form action={() => setIsSaved(true)}>
      <button onClick={() => setClicks(1)}>save</button>
      <button formAction={() => setIsAlternate(true)} onClick={() => setClicks(2)}>
        alternate
      </button>
      {clicks > 0 && (isSaved || isAlternate) ? <i>done</i> : <i>open</i>}
    </form>
  );
};

export const CheckboxInput = () => {
  const [clicks, setClicks] = useState(0);
  const [inputs, setInputs] = useState(0);
  return (
    <div>
      <input
        type="checkbox"
        aria-label="kept"
        onClick={() => setClicks(1)}
        onInput={() => setInputs(1)}
      />
      <input
        type="checkbox"
        aria-label="prevented"
        onClick={(event) => {
          event.preventDefault();
          setClicks(2);
        }}
        onInput={() => setInputs(2)}
      />
      {clicks > 0 && inputs > 0 ? <i>both</i> : <i>one</i>}
    </div>
  );
};

export const BubbledFormEvents = () => {
  const [clicks, setClicks] = useState(0);
  const [isSent, setIsSent] = useState(false);
  const [isCaptured, setIsCaptured] = useState(false);
  const [isReset, setIsReset] = useState(false);
  return (
    <div
      onSubmit={() => setIsSent(true)}
      onSubmitCapture={() => setIsCaptured(true)}
      onReset={() => setIsReset(true)}
    >
      <form onSubmit={(event) => event.preventDefault()}>
        <button onClick={() => setClicks(1)}>send</button>
        <button type="reset" onClick={() => setClicks(2)}>
          clear
        </button>
      </form>
      {clicks > 0 && (isSent || isCaptured || isReset) ? <i>done</i> : <i>open</i>}
    </div>
  );
};

export const ToggleAfterClick = () => {
  const [count, setCount] = useState(0);
  return (
    <details onToggle={() => count === 1 && setCount(2)}>
      <summary onClick={() => setCount(1)}>more</summary>
      {count === 0 ? <i>zero</i> : count === 1 ? <i>one</i> : <i>two</i>}
    </details>
  );
};

export const UnchangedInput = () => {
  const [inputs, setInputs] = useState(0);
  const [changes, setChanges] = useState(0);
  return (
    <div>
      <input aria-label="field" onInput={() => setInputs(1)} onChange={() => setChanges(1)} />
      {inputs > 0 && changes === 0 ? <i>input only</i> : <i>other</i>}
    </div>
  );
};

export const TargetCapture = () => {
  const [order, setOrder] = useState("");
  const [isCaptured, setIsCaptured] = useState(false);
  const [isOuter, setIsOuter] = useState(false);
  return (
    <div onClick={() => setIsOuter(true)}>
      <button
        onClickCapture={() => setOrder("capture")}
        onClick={() => setOrder((current) => `${current}-target`)}
      >
        both
      </button>
      <button onClickCapture={() => setIsCaptured(true)}>capture</button>
      {order === "capture-target" || (isCaptured && isOuter) ? <i>done</i> : <i>open</i>}
    </div>
  );
};

export const MaybeStoppedPrevent = () => {
  const [isArmed, setIsArmed] = useState(false);
  const [isSent, setIsSent] = useState(false);
  return (
    <form onSubmit={() => setIsSent(true)}>
      <button type="button" onClick={() => setIsArmed(!isArmed)}>
        arm
      </button>
      <button
        onClickCapture={(event) => {
          if (isArmed) event.stopPropagation();
        }}
        onClick={(event) => event.preventDefault()}
      >
        send
      </button>
      {isSent ? <i>sent</i> : <i>open</i>}
    </form>
  );
};

export const InputAfterCommit = () => {
  const [clicks, setClicks] = useState(0);
  const [isSeen, setIsSeen] = useState(false);
  return (
    <div>
      <input
        type="checkbox"
        aria-label="box"
        checked={clicks > 0}
        onClick={() => setClicks(1)}
        onInput={() => clicks === 1 && setIsSeen(true)}
      />
      {isSeen ? <i>seen</i> : <i>unseen</i>}
    </div>
  );
};
