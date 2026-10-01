import {
  forwardRef,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import { createPortal } from "react-dom";

// Mantine's `Portal`: a layout effect flips `mounted` and creates the portal
// node into a ref, so once effects settle the portal renders into that node.

interface PortalNodeProps {
  className?: string;
  id?: string;
  style?: object;
}

interface PortalProps extends PortalNodeProps {
  children: ReactNode;
  target?: HTMLElement | string;
}

const useIsomorphicEffect = typeof document !== "undefined" ? useLayoutEffect : useEffect;

const filterProps = (props: object): object =>
  Object.fromEntries(Object.entries(props).filter(([, value]) => value !== undefined));

const useProps = <T extends object>(defaultProps: Partial<T>, props: T): T => ({
  ...props,
  ...defaultProps,
  ...filterProps(props),
});

const assignRef = <T,>(ref: Ref<T> | undefined, value: T) => {
  if (typeof ref === "function") {
    ref(value);
  } else if (typeof ref === "object" && ref !== null && "current" in ref) {
    ref.current = value;
  }
};

const createPortalNode = (props: PortalNodeProps): HTMLDivElement => {
  const node = document.createElement("div");
  node.setAttribute("data-portal", "true");
  if (typeof props.className === "string") {
    node.classList.add(...props.className.split(" ").filter(Boolean));
  }
  if (typeof props.style === "object") Object.assign(node.style, props.style);
  if (typeof props.id === "string") node.setAttribute("id", props.id);
  return node;
};

const defaultProps: Partial<PortalProps> = {};

const Portal = forwardRef<HTMLElement, PortalProps>((props, ref) => {
  const { children, target, ...others } = useProps(defaultProps, props);
  const [mounted, setMounted] = useState(false);
  const nodeRef = useRef<HTMLElement | null>(null);
  useIsomorphicEffect(() => {
    setMounted(true);
    nodeRef.current = !target
      ? createPortalNode(others)
      : typeof target === "string"
        ? document.querySelector(target)
        : target;
    assignRef(ref, nodeRef.current);
    if (!target && nodeRef.current) {
      document.body.appendChild(nodeRef.current);
    }
    return () => {
      if (!target && nodeRef.current) {
        document.body.removeChild(nodeRef.current);
      }
    };
  }, [target]);
  if (!mounted || !nodeRef.current) {
    return null;
  }
  return createPortal(<>{children}</>, nodeRef.current);
});

const OptionalPortal = ({
  withinPortal = true,
  children,
  ...others
}: PortalProps & { withinPortal?: boolean }) =>
  withinPortal ? <Portal {...others}>{children}</Portal> : <>{children}</>;

export default function EffectCreatedPortal() {
  return (
    <main>
      <p>host</p>
      <Portal className="tooltip layer" id="tooltips">
        <span>first</span>
      </Portal>
      <OptionalPortal>
        <span>second</span>
      </OptionalPortal>
      <OptionalPortal withinPortal={false}>
        <span>inline</span>
      </OptionalPortal>
    </main>
  );
}
