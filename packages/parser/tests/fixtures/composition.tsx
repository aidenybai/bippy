import type { ReactNode } from "react";
import { Card, CardBody, CardHeader } from "./shared/card";
import { Button } from "./shared/button";

interface LayoutProps {
  title: string;
  sidebar?: ReactNode;
  children: ReactNode;
}

const Layout = ({ title, sidebar, children }: LayoutProps) => (
  <div className="layout">
    <h2>{title}</h2>
    {sidebar ? <aside>{sidebar}</aside> : null}
    <main>{children}</main>
  </div>
);

const RenderProp = ({ render }: { render: (value: string) => ReactNode }) => <div>{render("value")}</div>;

const Compound = () => (
  <Card>
    <Card.Header>compound header</Card.Header>
    <Card.Body>
      <CardHeader>direct header</CardHeader>
      <CardBody>direct body</CardBody>
    </Card.Body>
  </Card>
);

export default function Composition() {
  return (
    <Layout title="Composition" sidebar={<nav>links</nav>}>
      <RenderProp render={(value) => <code>{value}</code>} />
      <Compound />
      <Button variant="primary">Save</Button>
      <Button>Cancel</Button>
    </Layout>
  );
}
