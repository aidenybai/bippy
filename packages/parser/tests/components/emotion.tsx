import { css, Global, ThemeProvider, useTheme, withTheme } from "@emotion/react";
import styled from "@emotion/styled";
import { forwardRef, type ReactNode } from "react";

// Emotion without its babel plugin: unlabeled styled components, composition
// over a styled base, `as`, custom `shouldForwardProp`, `withComponent`, the
// theme context, `Global`, and a `displayName` assigned over the label (MUI's
// `createStyled` names slots `MuiDialog-root` for CSS and `MuiDialogRoot` for React).

interface Theme {
  accent: string;
}

const theme: Theme = { accent: "rebeccapurple" };

const Card = styled.section`
  padding: 8px;
`;

const Title = styled("h2", { label: "Title" })`
  color: ${(props: { theme: Theme }) => props.theme.accent};
`;

const Backdrop = styled("div", { label: "MuiBackdrop-root" })`
  opacity: 0.5;
`;
Backdrop.displayName = "MuiBackdropRoot";

const Box = styled.div<{ gap?: number; hidden?: boolean }>`
  gap: ${(props) => props.gap ?? 0}px;
`;

const Row = styled(Box, {
  shouldForwardProp: (prop) => prop !== "gap" && prop !== "align",
})<{ align?: string }>`
  display: flex;
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

const NoteLink = Note.withComponent(Anchor);

const Themed = withTheme(({ theme: current }: { theme: Theme }) => (
  <em data-accent={current.accent}>themed</em>
));

const Accent = () => {
  const current = useTheme();
  return <strong>{css({ color: current.accent }).name.length > 0 ? "on" : "off"}</strong>;
};

export default function Emotion() {
  return (
    <ThemeProvider theme={theme}>
      <Global styles={{ body: { margin: 0 } }} />
      <Card>
        <Title>Emotion</Title>
        <Backdrop aria-hidden />
        <Row gap={4} align="center" hidden={false}>
          <Box as="span">left</Box>
          <Box as="span" gap={2}>
            right
          </Box>
        </Row>
        <Note>plain note</Note>
        <NoteLink href="/docs">linked note</NoteLink>
        <Themed />
        <Accent />
      </Card>
    </ThemeProvider>
  );
}
