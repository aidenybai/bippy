import { createRoot } from "react-dom/client";

const flag = process.env.FEATURE_FLAG;

const Enabled = () => <strong>enabled</strong>;
const Disabled = () => <em>disabled</em>;
const Text = () => <i>text</i>;
const Other = () => <u>other</u>;

const App = () => (
  <section>
    {flag ? <Enabled /> : <Disabled />}
    <span>{flag ? "on" : "off"}</span>
    {typeof flag === "string" ? <Text /> : <Other />}
  </section>
);

createRoot(document.getElementById("root") ?? document.body).render(<App />);
