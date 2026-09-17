import type { ComponentType, ReactElement, ReactNode } from "react";
import { type TranslateProps, translate } from "translate-kit";
import { type ThemeProps, withTheme } from "./with-theme";

interface PageComponent<Props> extends ComponentType<Props> {
  getLayout?: (page: ReactElement) => ReactNode;
  getBadge?: () => ReactNode;
}

interface HomeProps extends ThemeProps {
  title?: string;
}

const Home: PageComponent<HomeProps> = ({ theme, title = "untitled" }) => (
  <h1 className={theme}>{title}</h1>
);
Home.getLayout = (page) => <main id="layout">{page}</main>;
Home.getBadge = () => <em>home</em>;
Home.displayName = "HomePage";

const Page: PageComponent<{ title?: string }> = withTheme(Home);

const Greeting: PageComponent<TranslateProps> = ({ t }) => <p>{t("greeting")}</p>;
Greeting.getBadge = () => <em>greeting</em>;
const TranslatedGreeting: PageComponent<object> = translate()(Greeting);

export const App = () => {
  const getLayout = Page.getLayout ?? ((page: ReactElement) => page);
  return (
    <>
      {getLayout(<Page title="hoisted" />)}
      {Page.getBadge ? Page.getBadge() : <em>no badge</em>}
      <TranslatedGreeting />
      {TranslatedGreeting.getBadge ? TranslatedGreeting.getBadge() : <em>no badge</em>}
    </>
  );
};
