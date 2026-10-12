import { useConfig } from "./hooks/config-store";

/**
 * Every read of a zustand store is a field of one value, and an action called through
 * any of them sets the fields its store says it does.
 */

// jsoncrack apps/www/src/features/editor/Toolbar/ThemeToggle.tsx
export function ThemeToggle() {
  const darkmodeEnabled = useConfig((state) => state.darkmodeEnabled);
  const toggleDarkMode = useConfig((state) => state.toggleDarkMode);
  const flipRulers = useConfig((state) => state.flipRulers);
  const reset = useConfig((state) => state.reset);
  return (
    <div>
      <button type="button" onClick={() => toggleDarkMode(!darkmodeEnabled)}>
        {darkmodeEnabled ? "Light" : "Dark"}
      </button>
      <button type="button" onClick={flipRulers}>
        Rulers
      </button>
      <button type="button" onClick={reset}>
        Reset
      </button>
    </div>
  );
}
