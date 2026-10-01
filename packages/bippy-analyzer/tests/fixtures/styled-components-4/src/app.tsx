import styled, { createGlobalStyle, css, ThemeProvider, withTheme } from "styled-components";

const theme = { accent: "tomato" };

const GlobalStyle = createGlobalStyle`
  body {
    margin: 0;
  }
`;

const ThemedGlobalStyle = createGlobalStyle`
  body {
    color: ${(props) => props.theme.accent};
  }
`;

const Shell = styled.div`
  display: grid;
`;

const Title = styled.h1<{ muted?: boolean }>`
  color: ${(props) => props.theme.accent};
  ${(props) =>
    props.muted &&
    css`
      opacity: 0.5;
    `}
`;

const Quiet = styled(Title)`
  letter-spacing: 0.1em;
`;

const Badge = styled.span.attrs({ as: "strong" })`
  font-weight: bold;
`;

const Swatch = withTheme(({ theme: { accent } }: { theme: { accent: string } }) => (
  <em>{accent}</em>
));

export const App = () => (
  <ThemeProvider theme={theme}>
    <>
      <GlobalStyle />
      <ThemedGlobalStyle />
      <Shell>
        <Title>Styled</Title>
        <Quiet muted>quiet</Quiet>
        <Badge>badge</Badge>
        <Badge as="b">bold badge</Badge>
        <Swatch />
      </Shell>
    </>
  </ThemeProvider>
);
