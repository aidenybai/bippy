const now = new Date();
const year = now.getFullYear();
const isModernEra = year >= 2020 && year <= 2100;
const isLegacyYear = now.getYear() < 120;
const utcYear = now.getUTCFullYear();

export const App = () => (
  <footer>
    {isModernEra ? <strong>modern</strong> : <em>legacy</em>}
    {isLegacyYear ? <em>pre-2020</em> : <strong>post-2020</strong>}
    {utcYear > 2000 ? <span>utc modern</span> : <span>utc legacy</span>}
  </footer>
);
