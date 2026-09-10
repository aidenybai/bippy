import styled from "@emotion/styled";
import { useState } from "react";

// MUI's `createStyled` renames the Emotion component after creating it
// (`Component.displayName = "MuiButtonRoot"`); the assigned name is what
// React DevTools and bippy report for the fiber.

const Root = styled("nav")`
  display: flex;
`;
Root.displayName = "MuiNavRoot";

const Chip = ({ label }: { label: string }) => <span>{label}</span>;

export default function Toolbar() {
  const [count, setCount] = useState(2);
  return (
    <Root>
      {Array.from({ length: count }, (_, index) => (
        <Chip key={index} label={`chip ${index}`} />
      ))}
      <button onClick={() => setCount(count + 1)}>add</button>
    </Root>
  );
}
