import { ClientMarkdown } from "@/components/client-markdown";
import Markdown from "react-markdown";

const MarkdownPage = () => (
  <main>
    <Markdown>{"Server **Markdown**"}</Markdown>
    <ClientMarkdown />
  </main>
);

export default MarkdownPage;
