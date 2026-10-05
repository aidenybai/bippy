import logoUrl from "./icons/logo.svg";
import Logo from "./icons/logo.svg?react";
import SettingsGear from "./icons/settings-gear.svg?react";

export const App = () => (
  <main>
    <img src={logoUrl} alt="logo" />
    <Logo />
    <button type="button">
      <SettingsGear aria-label="Settings" />
    </button>
  </main>
);
