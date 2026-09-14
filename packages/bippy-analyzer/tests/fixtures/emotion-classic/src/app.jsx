/** @jsxRuntime classic */
/** @jsx jsx */
import { css, jsx } from "@emotion/core";

const note = css({ margin: 0 });

const Card = ({ title, children }) => (
  <section css={{ padding: 8 }}>
    <h2 css={(theme) => ({ color: theme.accent ?? "teal" })}>{title}</h2>
    {children}
  </section>
);

export const App = () => (
  <Card title="Emotion 10">
    <p>plain</p>
    <p css={note} className="note">
      styled
    </p>
    <ul>
      {["a", "b"].map((item) => (
        <li key={item} css={{ listStyle: "none" }}>
          {item}
        </li>
      ))}
    </ul>
  </Card>
);
