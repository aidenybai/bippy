import type { ComponentType, ReactNode } from "react";

declare global {
  interface Window {
    __PRELOADED_STATE__?: unknown;
  }
}

interface FieldProps {
  label: string;
}

interface Selector {
  (state: unknown, ownProps: FieldProps): { Field: ComponentType<FieldProps> };
}

interface SelectorProxy extends Selector {
  mapToProps: Selector;
  dependsOnOwnProps: boolean;
}

/** react-redux's `wrapMapToPropsFunc`: the proxy swaps in the real selector on first call, then calls itself again. */
const wrapSelector = (selector: Selector): SelectorProxy => {
  const proxy: SelectorProxy = Object.assign(
    (state: unknown, ownProps: FieldProps) =>
      proxy.dependsOnOwnProps
        ? proxy.mapToProps(state, ownProps)
        : proxy.mapToProps(state, ownProps),
    { dependsOnOwnProps: true, mapToProps: selector },
  );
  proxy.mapToProps = (state, ownProps) => {
    proxy.mapToProps = selector;
    proxy.dependsOnOwnProps = selector.length !== 1;
    return proxy(state, ownProps);
  };
  return proxy;
};

const Meter = ({ label }: FieldProps) => <meter value={40}>{label}</meter>;

const selectField = wrapSelector(() => ({ Field: Meter }));

const Bar = (props: FieldProps): ReactNode => {
  const { Field } = selectField(window.__PRELOADED_STATE__, props);
  return <Field {...props} />;
};

export default function SelfRewritingProxy() {
  return (
    <section>
      <Bar label="first" />
      <Bar label="second" />
    </section>
  );
}
