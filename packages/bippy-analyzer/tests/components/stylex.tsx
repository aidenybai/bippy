import * as stylex from "@stylexjs/stylex";
import { type ReactNode, useState } from "react";

// StyleX as `@stylexjs/unplugin` compiles it for a dev server: `create`,
// `keyframes`, `defaultMarker` and `when` are compiled away, `props` runs and
// merges compiled styles, dynamic styles, nullish/false arguments and arrays
// into `className`, `style` and the debug `data-style-src`. The merged object
// is spread on host elements and passed through a component's props.

const fadeIn = stylex.keyframes({
  from: { opacity: 0 },
  to: { opacity: 1 },
});

const styles = stylex.create({
  root: {
    display: "flex",
    animationName: fadeIn,
  },
  active: {
    color: "red",
  },
  reveal: {
    visibility: {
      default: "hidden",
      [stylex.when.ancestor(":hover")]: "visible",
    },
  },
  width: (width: number) => ({
    width,
  }),
});

interface LabelProps {
  style?: stylex.StyleXStyles;
  children: ReactNode;
}

const Label = ({ style, children }: LabelProps) => {
  const { className, ...rest } = stylex.props(styles.active, style);
  return (
    <span className={className} data-has-style={"style" in rest}>
      {children}
    </span>
  );
};

export const isExact = true;

export default function StylexApp() {
  const [isActive, setIsActive] = useState(false);
  return (
    <div {...stylex.props(styles.root, isActive && styles.active)}>
      <button type="button" onClick={() => setIsActive(!isActive)}>
        toggle
      </button>
      <Label style={styles.reveal}>label</Label>
      <Label style={[styles.reveal, styles.width(120)]}>sized label</Label>
      <p {...stylex.props(null, undefined, false, [styles.root, [styles.active]])}>nested</p>
      <section {...stylex.props(stylex.defaultMarker(), styles.reveal)}>marker</section>
      <em {...stylex.props(styles.width(40))}>dynamic</em>
    </div>
  );
}
