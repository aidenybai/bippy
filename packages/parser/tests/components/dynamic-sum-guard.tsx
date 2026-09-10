import { Component, createContext, useContext, type ReactNode } from "react";

const HeaderHeightContext = createContext<number | undefined>(undefined);

interface GlobalWithInsets {
  __insets?: { top: number };
}

const readTopInset = (): number => Number((globalThis as GlobalWithInsets).__insets?.top);

const useHeaderHeight = (): number => {
  const height = useContext(HeaderHeightContext);
  if (height === undefined) {
    throw new Error("Couldn't find the header height.");
  }
  return height;
};

class Boundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    return this.state.hasError ? <p>crashed</p> : this.props.children;
  }
}

const Screen = ({ children }: { children: ReactNode }) => (
  <HeaderHeightContext.Provider value={64 + readTopInset()}>
    {children}
  </HeaderHeightContext.Provider>
);

const Content = () => {
  const height = useHeaderHeight();
  return <main data-has-height={height !== undefined && height !== null}>content</main>;
};

export const isExact = true;

export default function DynamicSumGuard() {
  return (
    <Boundary>
      <Screen>
        <Content />
      </Screen>
    </Boundary>
  );
}
