import { css, cx } from "@linaria/core";
import { styled } from "@linaria/react";
import { forwardRef, type ReactNode } from "react";

// Linaria as wyw-in-js ships it: `styled.div`...`` is rewritten at build time
// into `styled("div")({ name, class, propsAsIs })`, so this is the runtime
// form. Covers host tags, `as`, composition over a styled base (rendering the
// base with `as`), custom components, `propsAsIs` and the `css`/`cx` helpers.

const Card = styled("section")({ name: "Card", class: "l-card", propsAsIs: false });

const Box = styled("div")({ name: "Box", class: "l-box", propsAsIs: false });

const Row = styled(Box)({ name: "Row", class: "l-row", propsAsIs: false });

const Base = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <p className={className}>{children}</p>
);

const Note = styled(Base)({ name: "Note", class: "l-note", propsAsIs: false });

const Anchor = forwardRef<HTMLAnchorElement, { href: string; children?: ReactNode }>(
  ({ href, children }, ref) => (
    <a href={href} ref={ref}>
      {children}
    </a>
  ),
);

const NoteLink = styled(Note)({ name: "NoteLink", class: "l-note-link", propsAsIs: true });

const emphasis = css`
  font-style: italic;
`;

export default function Linaria() {
  return (
    <Card>
      <Row gap={4} align="center" hidden={false}>
        <Box as="span">left</Box>
        <Box as="span" className={cx(emphasis, "extra")}>
          right
        </Box>
      </Row>
      <Note>plain note</Note>
      <NoteLink as={Anchor} href="/docs">
        linked note
      </NoteLink>
    </Card>
  );
}
