import {
  createContext,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export const Overlay = ({ container }: { container?: Element | null }) => {
  const [mounted, setMounted] = useState(false);
  useIsomorphicLayoutEffect(() => setMounted(true), []);
  const target = container ?? (mounted ? document.body : null);
  return target ? createPortal(<p>overlay</p>, target) : null;
};

declare const handleSubmit: (onValid: (data: unknown) => void) => () => void;

export const SignUp = () => {
  const [isLoading, setIsLoading] = useState(false);
  const onSubmit = () => setIsLoading(true);
  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <button disabled={isLoading}>{isLoading ? "Saving" : "Sign up"}</button>
    </form>
  );
};

declare const mutateAsync: (data: string, options: { onSuccess: (key: string) => void }) => void;

export const ApiKeyForm = () => {
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  return createdKey ? (
    <p>{createdKey}</p>
  ) : (
    <button onClick={() => mutateAsync("key", { onSuccess: (key) => setCreatedKey(key) })}>
      Create
    </button>
  );
};

export const Truncated = ({ text }: { text: string }) => {
  const [isOverflown, setIsOverflown] = useState(false);
  const refCallback = (node: HTMLDivElement | null) => {
    if (node && node.scrollWidth > node.clientWidth) setIsOverflown(true);
  };
  return isOverflown ? <abbr title={text}>{text}</abbr> : <div ref={refCallback}>{text}</div>;
};

const Regions = ({ children }: { children: (codes: string[]) => React.ReactNode }) => (
  <svg>{children(["FR", "JP"])}</svg>
);

export const RegionMap = () => {
  const [hovered, setHovered] = useState<string | null>(null);
  return (
    <div>
      <Regions>
        {(codes) => codes.map((code) => <path key={code} onMouseOver={() => setHovered(code)} />)}
      </Regions>
      {hovered ? <p>{hovered}</p> : null}
    </div>
  );
};

declare const recognition: { onresult: ((text: string) => void) | null; start: () => void };

export const Dictation = () => {
  const [transcript, setTranscript] = useState("");
  const listen = () => {
    recognition.onresult = (text) => setTranscript(text);
    recognition.start();
  };
  return transcript ? <p>{transcript}</p> : <button onClick={listen}>Listen</button>;
};

export const Reactions = () => {
  const [current, setCurrent] = useState<string | null>(null);
  const Emoji = ({ emoji }: { emoji: string }) => (
    <button onClick={() => setCurrent(emoji)}>{emoji}</button>
  );
  return (
    <div>
      <Emoji emoji="❤️" />
      {current ? <p>{current}</p> : null}
    </div>
  );
};

export const Seeker = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [time, setTime] = useState(0);
  const handleSeek = (event: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current;
    if (!video) return;
    setTime(Number(event.target.value));
  };
  return (
    <div>
      <video ref={videoRef} />
      <input onChange={handleSeek} />
      {time > 0 ? <p>Seeked</p> : <p>Start</p>}
    </div>
  );
};

export const PortalToolbar = () => {
  const [liked, setLiked] = useState(false);
  return createPortal(
    <button onClick={() => setLiked(true)}>{liked ? "Liked" : "Like"}</button>,
    document.body,
  );
};

export const Tooltip = ({ label }: { label: string }) => {
  const [tooltip, setTooltip] = useState();
  return (
    <div
      onMouseOver={() => setTooltip(`${label}!` as any)}
      onMouseOut={() => setTooltip(undefined)}
    >
      {tooltip ? <p>{tooltip}</p> : null}
    </div>
  );
};

export const DragPreview = ({ isDocument }: { isDocument: boolean }) => {
  const [draggedDocument, setDraggedDocument] = useState<string | null>(null);
  const [draggedFolder, setDraggedFolder] = useState<string | null>(null);
  const startDrag = (setDragged: (id: string) => void) => setDragged("item");
  return (
    <div onDragStart={() => startDrag(isDocument ? setDraggedDocument : setDraggedFolder)}>
      {draggedDocument ? <p>Document</p> : null}
      {draggedFolder ? <p>Folder</p> : null}
    </div>
  );
};

declare const verify: (code: string) => Promise<void>;

export const TwoFactor = () => {
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    try {
      await verify("123456");
    } catch {
      setError("Invalid code");
    }
  };
  return (
    <div>
      <button onClick={submit}>Verify</button>
      {error ? <p>{error}</p> : null}
    </div>
  );
};

const EditorContext = createContext<{ openEditor: () => void } | null>(null);

export const MemoCard = ({ children }: { children: React.ReactNode }) => {
  const [showEditor, setShowEditor] = useState(false);
  const openEditor = () => setShowEditor(true);
  return (
    <EditorContext.Provider value={{ openEditor }}>
      {showEditor ? <textarea /> : children}
    </EditorContext.Provider>
  );
};

export const Drawer = forwardRef<{ open: () => void }>((_, ref) => {
  const [isOpen, setIsOpen] = useState(false);
  useImperativeHandle(ref, () => ({ open: () => setIsOpen(true) }));
  return isOpen ? <aside>Drawer</aside> : null;
});

declare class EditorView {
  constructor(options: { handleDOMEvents: { click: () => boolean } });
}

export const SuggestionEditor = () => {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    new EditorView({
      handleDOMEvents: {
        click() {
          setActive("suggestion");
          return true;
        },
      },
    });
  }, []);
  return active ? <p>{active}</p> : <div />;
};

export const WorkspaceLoader = ({ load }: { load: () => Promise<void> }) => {
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    void (async () => await fetchWorkspace())();
  }, []);
  const fetchWorkspace = async () => {
    setLoading(true);
    await load();
    setLoading(false);
  };
  return loading ? <p>Loading</p> : <p>Ready</p>;
};
