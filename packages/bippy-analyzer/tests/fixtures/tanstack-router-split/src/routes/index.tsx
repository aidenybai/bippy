import { createFileRoute } from "@tanstack/react-router";

const Greeting = ({ name }: { name: string }) => <p>Hello, {name}</p>;

const Index = () => (
  <section>
    <Greeting name="split" />
  </section>
);

export const Route = createFileRoute("/")({ component: Index });
