interface DialogButtonProps {
  label: string;
  isOpen?: boolean;
}

export const DialogButton = ({ label, isOpen }: DialogButtonProps) =>
  isOpen === undefined ? <button>{label}</button> : <dialog open={isOpen}>{label}</dialog>;
