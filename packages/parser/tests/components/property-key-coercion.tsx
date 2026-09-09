import { Component, forwardRef, memo } from "react";

const svgForwardProps: Record<string, string[]> = {
  path: ["d"],
  circle: ["cx", "cy", "r"],
  "[object Object]": ["wrapper"],
  "1,2": ["pair"],
  "/circle/g": ["pattern"],
};

const hasProp = (target: object, key: unknown): boolean =>
  Object.prototype.hasOwnProperty.call(target, key);

const Plain = ({ label }: { label: string }) => <span>{label}</span>;
const Wrapped = forwardRef<HTMLSpanElement, { label: string }>((props, ref) => (
  <span ref={ref}>{props.label}</span>
));
const Memoized = memo(Plain);
class Stateful extends Component<{ label: string }> {
  render() {
    return <span>{this.props.label}</span>;
  }
}

const describeForwarding = (tag: unknown): string => {
  const key = tag as string;
  const forwarded = hasProp(svgForwardProps, tag) ? svgForwardProps[key] : [];
  const byIndex = svgForwardProps[key];
  const isIn = key in svgForwardProps;
  return `${forwarded.join("+") || "none"}/${byIndex ? byIndex.length : 0}/${isIn}`;
};

const Line = ({ label, text }: { label: string; text: string }) => (
  <li>
    <b>{label}</b> {text}
  </li>
);

const Report = () => (
  <ul>
    <Line label="string" text={describeForwarding("path")} />
    <Line label="function" text={describeForwarding(Plain)} />
    <Line label="forwardRef" text={describeForwarding(Wrapped)} />
    <Line label="memo" text={describeForwarding(Memoized)} />
    <Line label="class" text={describeForwarding(Stateful)} />
    <Line label="object" text={describeForwarding({ nested: true })} />
    <Line label="array" text={describeForwarding([1, 2])} />
    <Line label="element" text={describeForwarding(<Plain label="element" />)} />
    <Line label="regexp" text={describeForwarding(/circle/g)} />
    <Line label="String(memo)" text={String(Memoized)} />
    <Line label="String(arrow)" text={String(Plain).startsWith("(") ? "arrow source" : "other"} />
  </ul>
);

export default function PropertyKeyCoercion() {
  return (
    <main>
      <Report />
      <Plain label="plain" />
      <Wrapped label="wrapped" />
      <Memoized label="memoized" />
      <Stateful label="stateful" />
    </main>
  );
}

export const isExact = true;
