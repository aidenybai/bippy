import { Card, Stack } from "ui-kit";

export const App = () => (
  <Stack gap={2}>
    <h3>before</h3>
    <Card title="opaque">
      <p>inside card</p>
    </Card>
    <h3>after</h3>
  </Stack>
);
