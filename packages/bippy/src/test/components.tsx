import React from 'react';

export const CountContext = React.createContext(0);
export const ExtraContext = React.createContext(0);

export const BasicComponent = () => {
  return <div>Hello</div>;
};

BasicComponent.displayName = 'BasicComponent';

export const BasicComponentWithEffect = () => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_shouldUnmount, _setShouldUnmount] = React.useState(true);
  React.useEffect(() => {}, []);
  return <div>Hello</div>;
};

export const BasicComponentWithUnmount = () => {
  const [shouldUnmount, setShouldUnmount] = React.useState(true);
  React.useEffect(() => {
    setShouldUnmount(false);
  }, []);
  return shouldUnmount ? <div>Hello</div> : null;
};

export const BasicComponentWithMutation = () => {
  const [element, setElement] = React.useState(<div>Hello</div>);
  React.useEffect(() => {
    setElement(<div>Bye</div>);
  }, []);
  return element;
};

export const BasicComponentWithChildren = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  return <div>{children}</div>;
};

export const BasicComponentWithMultipleElements = () => {
  return (
    <>
      <div>Hello</div>
      <div>Hello</div>
    </>
  );
};

export const SlowComponent = () => {
  for (let i = 0; i < 100; i++) {} // simulate slowdown
  return <div>Hello</div>;
};

export const ForwardRefComponent = React.forwardRef(BasicComponent);
export const MemoizedComponent = React.memo(BasicComponent);

export class ClassComponent extends React.Component {
  render() {
    return <div>Hello</div>;
  }
}

export const ComplexComponent = ({
  countProp = 0,
}: {
  countProp?: number;
  extraProp?: unknown;
}) => {
  const countContextValue = React.useContext(CountContext);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _extraContextValue = React.useContext(ExtraContext);
  const [countState, setCountState] = React.useState(0);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_extraState, _setExtraState] = React.useState(0);

  React.useEffect(() => {
    setCountState(countState + 1);
  }, []);

  return <div>{countContextValue + countState + countProp}</div>;
};
