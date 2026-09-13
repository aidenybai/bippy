import Logo from "./icons/logo.svg";
import SettingsGear from "./icons/settings-gear.svg";

export const App = () => (
  <main>
    <Logo role="img" />
    <SettingsGear title="Settings" />
    <SettingsGear title="" />
  </main>
);
