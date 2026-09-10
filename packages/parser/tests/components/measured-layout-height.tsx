import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

// Mirrors react-native-web's `UIManager.measure`: layout metrics are read from
// the DOM in a timeout and handed to a callback, whose numbers feed state.

const HeightContext = createContext<number | undefined>(undefined);

interface Rect {
  width: number;
  height: number;
  top: number;
  left: number;
}

const getRect = (element: HTMLElement): Rect => {
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
  top -= window.scrollY;
  left -= window.scrollX;
  return { width, height, top, left };
};

type MeasureCallback = (
  x: number,
  y: number,
  width: number,
  height: number,
  left: number,
  top: number,
) => void;

const measure = (node: HTMLElement | null, callback: MeasureCallback) => {
  const relativeNode = node && node.parentNode;
  if (node && relativeNode) {
    setTimeout(() => {
      if (node.isConnected && relativeNode.isConnected) {
        const relativeRect = getRect(relativeNode as HTMLElement);
        const { height, left, top, width } = getRect(node);
        callback(left - relativeRect.left, top - relativeRect.top, width, height, left, top);
      }
    }, 0);
  }
};

const useHeaderHeight = (): number => {
  const height = useContext(HeightContext);
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
  useLayoutEffect(() => {
    measure(headerRef.current, (_x, _y, _width, height) => {
      setHeaderHeight(height);
    });
  }, []);
  return (
    <section>
      <div ref={headerRef}>
        <h1>Title</h1>
      </div>
      <HeightContext.Provider value={headerHeight}>{children}</HeightContext.Provider>
    </section>
  );
};

export const isPartial = true;

export default function MeasuredLayoutHeight() {
  return (
    <Screen>
      <Content />
    </Screen>
  );
}
