import { type ReactNode, useState } from "react";

/**
 * A map of render functions passed as one prop; the child calls one while rendering and the
 * element it returns carries a handler that sets the parent's state.
 */

// prompt-kit app/docs/markdown/markdown-custom-components.tsx
interface DocComponents {
  link: (props: { children: string }) => ReactNode;
}

const Doc = ({ components }: { components: DocComponents }) => (
  <p>{components.link({ children: "Toggle theme" })}</p>
);

export function ThemedDoc() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const components: DocComponents = {
    link: ({ children }) => (
      <a
        href="#"
        onClick={(event) => {
          event.preventDefault();
          setTheme((current) => (current === "light" ? "dark" : "light"));
        }}
      >
        {children}
      </a>
    ),
  };
  return (
    <div className={theme}>
      <button
        type="button"
        onClick={() => setTheme((current) => (current === "light" ? "dark" : "light"))}
      >
        Toggle {theme === "light" ? "Dark" : "Light"} Mode
      </button>
      <Doc components={components} />
    </div>
  );
}
