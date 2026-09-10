import styled from "styled-components/macro";
import { Card } from "./components/Card";

const Shell = styled.main`
  display: grid;
`;

export const App = () => (
  <Shell>
    <Card title="configured" />
  </Shell>
);
