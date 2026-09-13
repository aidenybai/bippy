import * as Tabs from "@radix-ui/react-tabs";

export const App = () => (
  <Tabs.Root defaultValue="password">
    <Tabs.List aria-label="Sign in">
      <Tabs.Trigger value="password">Password</Tabs.Trigger>
      <Tabs.Trigger value="magic-link">Magic link</Tabs.Trigger>
    </Tabs.List>
  </Tabs.Root>
);
