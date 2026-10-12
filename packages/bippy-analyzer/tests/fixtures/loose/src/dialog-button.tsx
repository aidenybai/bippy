interface DialogButtonProps {
  label: string;
  isOpen?: boolean;
}

export const DialogButton = ({ label, isOpen }: DialogButtonProps) =>
  isOpen === undefined ? <button>{label}</button> : <dialog open={isOpen}>{label}</dialog>;

type Theme = "light" | "dark";

const getTheme = (name: string): Theme | undefined =>
  name === "light" || name === "dark" ? name : undefined;

export const ThemeLabel = ({ name }: { name: string }) =>
  getTheme(name) ? <p>Themed</p> : <button>Pick a theme</button>;
