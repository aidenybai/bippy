import { createElement, forwardRef, memo, type ReactNode, type Ref } from "react";

interface ScrollLockProps {
  enabled?: boolean;
  removeScrollBar?: boolean;
  children?: ReactNode;
}

const ScrollBar = () => <style data-testid="scroll-bar" />;

const ScrollLock = forwardRef<HTMLDivElement, ScrollLockProps>(
  ({ enabled, removeScrollBar, children }, forwardedRef: Ref<HTMLDivElement>) => (
    <div ref={forwardedRef} data-enabled={String(enabled)}>
      {enabled && removeScrollBar ? <ScrollBar /> : null}
      {children}
    </div>
  ),
);

ScrollLock.defaultProps = { enabled: true, removeScrollBar: true };

interface BadgeProps {
  tone?: string;
  label: string;
}

const Badge = memo(({ tone, label }: BadgeProps) => (
  <span className={`badge-${tone}`}>{label}</span>
));

Badge.defaultProps = { tone: "neutral" };

export default function WrapperDefaultProps() {
  return (
    <section>
      {createElement(ScrollLock, null, createElement(Badge, { label: "defaults" }))}
      {createElement(
        ScrollLock,
        { removeScrollBar: false },
        createElement(Badge, { tone: "warm", label: "explicit" }),
      )}
    </section>
  );
}
