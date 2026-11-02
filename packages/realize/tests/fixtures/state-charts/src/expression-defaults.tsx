import { useState } from "react";

const SIZES = { small: "sm", large: "lg" } as const;

type Size = (typeof SIZES)[keyof typeof SIZES];

export const Dialog = ({
  theme,
  size = SIZES.small,
  label = theme.closeLabel,
  icon = <span>×</span>,
}: {
  theme: { closeLabel: string };
  size?: Size;
  label?: string;
  icon?: React.ReactNode;
}) => {
  const [isOpen, setIsOpen] = useState(true);
  if (!isOpen) return null;
  return (
    <div className={size}>
      <button aria-label={label} onClick={() => setIsOpen(false)}>
        {icon}
      </button>
    </div>
  );
};

export const SizeLabel = ({ size, sizes }: { size: Size; sizes: typeof SIZES }) => {
  switch (size) {
    case sizes.small:
      return <p>Small</p>;
    case sizes.large:
      return <p>Large</p>;
  }
};
