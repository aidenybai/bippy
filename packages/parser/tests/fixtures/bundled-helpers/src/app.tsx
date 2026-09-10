import { Badge, Icon, ThemeProvider, Toolbar } from "bundle-kit";

export const App = () => (
  <ThemeProvider theme="dark">
    <Toolbar items={["home", "search", "settings"]} />
    <Icon name="star" className="solo" onClick={() => {}} />
    <Badge>new</Badge>
  </ThemeProvider>
);
