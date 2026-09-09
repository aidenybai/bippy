import styled from "styled-components";

export const ResponsiveWrapper = styled.div<{ $responsive: boolean }>`
  position: relative;
  overflow-x: ${({ $responsive }) => ($responsive ? "auto" : "visible")};
`;

const ScrollArea = styled.div<{ $height: string }>`
  max-height: ${({ $height }) => $height};
`;

export default ScrollArea;
