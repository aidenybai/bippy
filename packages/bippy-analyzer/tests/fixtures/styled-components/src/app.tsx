import styled, { css, ThemeProvider } from "styled-components";

const theme = { accent: "tomato" };

const Shell = styled.div`
  display: grid;
`;

const Title = styled.h1<{ $muted?: boolean }>`
  color: ${(props) => props.theme.accent};
  ${(props) =>
    props.$muted &&
    css`
      opacity: 0.5;
    `}
`;

const Quiet = styled(Title).withConfig({ shouldForwardProp: (prop) => prop !== "$muted" })`
  letter-spacing: 0.1em;
`;

const Badge = styled.span.withConfig({ displayName: "Badge" })`
  font-weight: bold;
`;

export const App = () => (
  <ThemeProvider theme={theme}>
    <Shell>
      <Title>Styled</Title>
      <Quiet $muted>quiet</Quiet>
      <Badge>badge</Badge>
    </Shell>
  </ThemeProvider>
);
