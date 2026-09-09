import styled, { css } from "styled-components";
import { Panel } from "./panel";
import { theme } from "./theme";

const Shell = styled.div`
  display: grid;
`;

const Title = styled.h1`
  color: ${theme.accent};
`;

const Quiet = styled(Title).withConfig({ shouldForwardProp: () => true })`
  opacity: 0.5;
`;

const Named = styled.span.withConfig({ displayName: "Badge" })`
  font-weight: bold;
`;

const emphasis = css`
  font-style: italic;
`;

const Note = styled.p`
  ${emphasis}
`;

export const App = () => (
  <Shell>
    <Title>Styled</Title>
    <Quiet>quiet</Quiet>
    <Named>badge</Named>
    <Note>note</Note>
    <Panel />
  </Shell>
);
