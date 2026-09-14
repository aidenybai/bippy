import logoUrl, { ReactComponent as Logo } from "./icons/logo.svg";
import { ReactComponent as SettingsGear } from "./icons/settings-gear.svg";

export const App = () => (
  <main>
    <img src={logoUrl} alt="logo" />
    <Logo />
    <button type="button">
      <SettingsGear title="Settings" />
    </button>
  </main>
);
