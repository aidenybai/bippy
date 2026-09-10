import { Component, forwardRef, type CSSProperties, type ReactNode } from "react";

class SharedValue {
  constructor(public value: number) {}
}

interface HostProps {
  href?: string;
  style?: CSSProperties | CSSProperties[];
  children?: ReactNode;
  onLayout?: () => void;
  "data-opacity"?: number;
  "data-edge"?: boolean;
  "data-title"?: unknown;
}

interface AnimatedProps extends Omit<HostProps, "data-opacity"> {
  "data-opacity"?: SharedValue | number;
}

const isSharedValue = (value: unknown): value is SharedValue => value instanceof SharedValue;

const has = <TKey extends string>(key: TKey, value: unknown): value is Record<TKey, unknown> =>
  typeof value === "object" && value !== null && key in value;

const isCallbackProp = (key: string): boolean =>
  key === "onTransitionEnd" || key === "onAnimationEnd";

const flattenArray = <TItem,>(array: TItem | TItem[]): TItem[] =>
  Array.isArray(array) ? array.flat() : [array];

const Inner = forwardRef<HTMLElement, HostProps>(
  ({ href, style, children, onLayout, ...rest }, _ref) => {
    const flattened = flattenArray(style ?? []);
    const hostProps = {
      ...rest,
      style: Object.assign({}, ...flattened),
      "data-layout": onLayout ? "observed" : "static",
    };
    if (href != null) {
      return (
        <a href={href} {...hostProps}>
          {children}
        </a>
      );
    }
    return <div {...hostProps}>{children}</div>;
  },
);

/** Mirrors Reanimated's `PropsFilter.filterNonAnimatedProps`: a `for..in` over the instance props, keyed writes into a fresh object. */
const filterNonAnimatedProps = (component: Component<AnimatedProps>): Record<string, unknown> => {
  const inputProps: Record<string, unknown> = component.props;
  const props: Record<string, unknown> = {};
  for (const key in inputProps) {
    const value = inputProps[key];
    if (key === "style") {
      const styles = flattenArray(inputProps.style ?? []);
      props[key] = styles.map((style) => (style && "viewDescriptors" in style ? {} : style));
    } else if (key === "animatedProps") {
      continue;
    } else if (has("workletEventHandler", value)) {
      props[key] = () => {};
    } else if (isSharedValue(value)) {
      props[key] = value.value;
    } else {
      props[key] = value;
    }
  }
  return props;
};

const omitCallbackProps = (props: Record<string, unknown>): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  for (const key in props) {
    if (!isCallbackProp(key)) result[key] = props[key];
  }
  return result;
};

const filterStyle = (style: unknown): unknown => {
  if (Array.isArray(style)) return style.map(filterStyle);
  if (!style || typeof style !== "object") return style;
  const result: Record<string, unknown> = {};
  for (const key in style) {
    result[key] = (style as Record<string, unknown>)[key];
  }
  return result;
};

const filterCssProps = (props: Record<string, unknown>): Record<string, unknown> => {
  const result = omitCallbackProps(props);
  if ("style" in props) result.style = filterStyle(props.style);
  return result;
};

class BaseAnimated extends Component<AnimatedProps> {
  render(props?: Record<string, unknown>) {
    return <Inner {...filterCssProps(props ?? this.props)} {...{}} ref={null} />;
  }
}

class Animated extends BaseAnimated {
  render() {
    const filtered = filterNonAnimatedProps(this);
    return super.render({ id: undefined, ...filtered });
  }
}

const opacity = new SharedValue(1);
const isEdge = Math.random() > 0.5;

export default function ClassPropsFilter() {
  return (
    <section>
      <Animated style={[{ flex: 1 }, { color: "red" }]} onLayout={() => {}}>
        <span>filtered</span>
      </Animated>
      <Animated href="/docs" style={{ display: "flex" }}>
        link
      </Animated>
      <Animated data-opacity={opacity}>shared</Animated>
      <Animated
        data-edge={isEdge || undefined}
        data-title={JSON.parse(window.location.hash.slice(1) || "null") || undefined}
      >
        branchy
      </Animated>
    </section>
  );
}
