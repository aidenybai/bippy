import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

// Mirrors react-native-web's `onLayout`: a shared ResizeObserver measures the
// observed node in a timeout and hands the numbers to the handler stored on it.

const LAYOUT_HANDLER = "__layoutHandler";

interface LayoutEvent {
  nativeEvent: { layout: { x: number; y: number; width: number; height: number } };
}

type LayoutHandler = (event: LayoutEvent) => void;

type LayoutTarget = Element & { [LAYOUT_HANDLER]?: LayoutHandler };

const getRect = (element: HTMLElement) => {
  const height = element.offsetHeight;
  const width = element.offsetWidth;
  let left = element.offsetLeft;
  let top = element.offsetTop;
  let node = element.offsetParent;
  while (node && node.nodeType === 1) {
    left += (node as HTMLElement).offsetLeft + node.clientLeft - node.scrollLeft;
    top += (node as HTMLElement).offsetTop + node.clientTop - node.scrollTop;
    node = (node as HTMLElement).offsetParent;
  }
  return { width, height, top: top - window.scrollY, left: left - window.scrollX };
};

const measure = (
  node: HTMLElement,
  callback: (x: number, y: number, width: number, height: number) => void,
) => {
  const relativeNode = node.parentNode;
  if (relativeNode) {
    setTimeout(() => {
      if (node.isConnected && relativeNode.isConnected) {
        const relativeRect = getRect(relativeNode as HTMLElement);
        const { height, left, top, width } = getRect(node);
        callback(left - relativeRect.left, top - relativeRect.top, width, height);
      }
    }, 0);
  }
};

let resizeObserver: ResizeObserver | null = null;

const getResizeObserver = (): ResizeObserver => {
  if (resizeObserver == null) {
    resizeObserver = new ResizeObserver((entries) => {
      entries.forEach((entry) => {
        const node = entry.target as LayoutTarget;
        const onLayout = node[LAYOUT_HANDLER];
        if (typeof onLayout === "function") {
          measure(node as HTMLElement, (x, y, width, height) => {
            onLayout({ nativeEvent: { layout: { x, y, width, height } } });
          });
        }
      });
    });
  }
  return resizeObserver;
};

const useElementLayout = (
  ref: React.RefObject<LayoutTarget | null>,
  onLayout: LayoutHandler,
): void => {
  const observer = getResizeObserver();
  useLayoutEffect(() => {
    const node = ref.current;
    if (node != null) node[LAYOUT_HANDLER] = onLayout;
  }, [ref, onLayout]);
  useLayoutEffect(() => {
    const node = ref.current;
    if (node != null) observer.observe(node);
    return () => {
      if (node != null) observer.unobserve(node);
    };
  }, [ref, observer]);
};

const HeaderHeightContext = createContext<number | undefined>(undefined);

const useHeaderHeight = (): number => {
  const height = useContext(HeaderHeightContext);
  if (height === undefined) {
    throw new Error("Couldn't find the header height.");
  }
  return height;
};

const Content = () => {
  const height = useHeaderHeight();
  return <p>{height === 64 ? <b>default</b> : <i>measured</i>}</p>;
};

const Screen = ({ children }: { children: ReactNode }) => {
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(64);
  useElementLayout(headerRef, (event) => {
    setHeaderHeight(event.nativeEvent.layout.height);
  });
  return (
    <section>
      <div ref={headerRef}>
        <h1>Title</h1>
      </div>
      <HeaderHeightContext.Provider value={headerHeight}>{children}</HeaderHeightContext.Provider>
    </section>
  );
};

export const isPartial = true;

export default function ResizeObserverLayout() {
  return (
    <Screen>
      <Content />
    </Screen>
  );
}
