import { createContext, useContext, type ReactNode } from "react";

const StackingContext = createContext(0);

const Stack = ({
  value = 0,
  children,
}: {
  value?: number;
  children: (zIndex: number) => ReactNode;
}) => {
  const previous = useContext(StackingContext);
  const current = Math.max(value, previous);
  return (
    <StackingContext.Provider value={current + 1}>{children(current)}</StackingContext.Provider>
  );
};

const Positioner = ({ label, children }: { label: string; children?: ReactNode }) => (
  <Stack>
    {(zIndex) => (
      <div data-label={label} style={{ zIndex }}>
        {children}
      </div>
    )}
  </Stack>
);

export const isExact = true;

export default function RecursionRenderProp() {
  return (
    <Positioner label="menu">
      <Positioner label="popover">
        <Positioner label="tooltip">
          <button type="button">open</button>
        </Positioner>
      </Positioner>
    </Positioner>
  );
}
