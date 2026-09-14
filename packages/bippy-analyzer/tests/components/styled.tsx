import { forwardRef, type ReactNode } from "react";
import styled, {
  createGlobalStyle,
  css,
  ThemeProvider,
  useTheme,
  withTheme,
} from "styled-components";

// styled-components without its babel plugin: `styled.tag`, `styled(Component)`,
// composition over a styled base, `as`/`forwardedAs`, transient `$props`,
// `.attrs()`, `.withConfig()`, the theme context and `createGlobalStyle`.

interface Theme {
  accent: string;
}

const theme: Theme = { accent: "rebeccapurple" };

const GlobalStyle = createGlobalStyle`
  body { margin: 0; }
`;

const Card = styled.section`
  padding: 8px;
`;

const Title = styled.h2.withConfig({ displayName: "Title" })`
  color: ${(props) => props.theme.accent};
`;

const Box = styled.div<{ $gap?: number; hidden?: boolean }>`
  gap: ${(props) => props.$gap ?? 0}px;
`;

const Row = styled(Box).withConfig({
  shouldForwardProp: (prop) => prop !== "align",
})<{ align?: string }>`
  display: flex;
`;

const Input = styled.input.attrs<{ $size?: number }>((props) => ({
  type: "text",
  size: props.$size ?? 8,
}))`
  border: 0;
`;

const Base = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <p className={className}>{children}</p>
);

const Note = styled(Base)`
  font-style: italic;
`;

const Anchor = forwardRef<HTMLAnchorElement, { href: string; children?: ReactNode }>(
  ({ href, children }, ref) => (
    <a href={href} ref={ref}>
      {children}
    </a>
  ),
);

const NoteLink = styled(Anchor)`
  text-decoration: none;
`;

const Themed = withTheme(({ theme: current }: { theme: Theme }) => (
  <em data-accent={current.accent}>themed</em>
));

const accentRule = css`
  color: red;
`;

const Accent = () => {
  const current = useTheme();
  return <strong>{current && accentRule.length > 0 ? "on" : "off"}</strong>;
};

export default function StyledComponents() {
  return (
    <ThemeProvider theme={theme}>
      <GlobalStyle />
      <Card>
        <Title>styled-components</Title>
        <Row $gap={4} align="center" hidden={false}>
          <Box as="span">left</Box>
          <Box as="span" $gap={2}>
            right
          </Box>
          <Input $size={4} />
        </Row>
        <Note>plain note</Note>
        <Note forwardedAs="a">note with forwardedAs</Note>
        <NoteLink href="/docs">linked note</NoteLink>
        <Themed />
        <Accent />
      </Card>
    </ThemeProvider>
  );
}
