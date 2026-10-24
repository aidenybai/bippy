type Theme = "light" | "dark";
type Notify = (message: string) => void;

declare function useTheme(): Theme;
declare function useNotify(): Notify;

export const ThemeBadge = () => {
  const theme: Theme = useTheme();
  const notify: Notify = useNotify();
  return <button onClick={() => notify(theme)}>{theme === "dark" ? "Dark" : "Light"}</button>;
};
