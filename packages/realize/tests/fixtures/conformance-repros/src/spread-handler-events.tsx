import { useState } from "react";

const useConfirm = () => {
  const [isArmed, setIsArmed] = useState(false);
  const getButtonProps = (onConfirm: () => void) => ({
    onBlur: () => setIsArmed(false),
    onClick: isArmed ? onConfirm : () => setIsArmed(true),
    onKeyUp: (event: { key: string }) => {
      if (event.key === "Escape") setIsArmed(false);
    },
  });
  return { isArmed, getButtonProps };
};

export const ConfirmDelete = () => {
  const [deleted, setDeleted] = useState(0);
  const confirm = useConfirm();
  return (
    <button {...confirm.getButtonProps(() => setDeleted(deleted + 1))}>
      {confirm.isArmed ? "sure?" : `delete (${deleted})`}
    </button>
  );
};
