import styled, { css } from "styled-components/macro";

const Shell = styled.div`
  display: grid;
`;

const Title = styled.h1`
  color: ${(props) => props.color ?? "rebeccapurple"};
`;

const Quiet = styled(Title)`
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
    <Quiet as="h2">quiet</Quiet>
    <Named>badge</Named>
    <Note>note</Note>
  </Shell>
);
