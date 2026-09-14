import { formatCount, translate } from "./phrases";

const Phrase = ({ text }: { text: string }) =>
  typeof text === "string" ? <b>{text}</b> : <i>missing</i>;

export const App = () => (
  <div>
    <Phrase text={translate("greeting")} />
    <Phrase text={formatCount("count")} />
  </div>
);
