import type { ComponentType, ReactElement, ReactNode } from "react";
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

export const App = () => {
  const getLayout = Page.getLayout ?? ((page: ReactElement) => page);
  return (
    <>
      {getLayout(<Page title="hoisted" />)}
      {Page.getBadge ? Page.getBadge() : <em>no badge</em>}
    </>
  );
};
