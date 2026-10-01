import { withEmotionCache } from "@emotion/react";
import styled from "@emotion/styled";
import { useRef, type ReactNode } from "react";

// `withEmotionCache(render)` is a `forwardRef` whose anonymous render calls
// `render(props, cache, ref)`: the ref is the third argument, not the second,
// and the fiber carries no name of its own, so `styled` over it labels
// `Styled(Component)`.

interface Props {
  className?: string;
  children?: ReactNode;
}

const Keyed = withEmotionCache(({ className, children }: Props, _cache, ref) => (
  <section ref={ref} className={className}>
    {ref === null ? "unreferenced" : "referenced"}
    {children}
  </section>
));

const Framed = styled(Keyed)`
  border: 1px solid;
`;

const describe = (component: { displayName?: string; name?: string }): string =>
  component.displayName || component.name || "Component";

export default function EmotionCache() {
  const sectionRef = useRef<HTMLElement>(null);
  return (
    <div>
      <Keyed>default cache</Keyed>
      <Keyed ref={sectionRef}>held cache</Keyed>
      <Framed>styled cache</Framed>
      <p>{describe(Keyed)}</p>
    </div>
  );
}
