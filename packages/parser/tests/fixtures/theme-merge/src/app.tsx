import { createTheme } from "./theme";

const theme = createTheme({ palette: { primary: { main: "#2196f3" }, tags: ["x", "y"] } });

export const App = () => (
  <section data-mode={theme.palette.mode}>
    {theme.palette.primary.contrastText !== undefined ? (
      <h1>{theme.palette.primary.main}</h1>
    ) : null}
    <ul>
      {theme.palette.tags.map((tag) => (
        <li key={tag}>{tag}</li>
      ))}
    </ul>
    {theme.shape.radius === 4 && theme.spacing === 8 ? <footer>merged</footer> : <p>lost</p>}
  </section>
);
