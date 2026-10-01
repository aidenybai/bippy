import styled from "@emotion/styled";

const Note = ({ children, className }: { children?: string; className?: string }) => (
  <p className={className}>{children}</p>
);

export default styled(Note)`
  font-style: italic;
`;
