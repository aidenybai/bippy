import { Head, Html, Main, NextScript } from "next/document";

interface DocumentProps {
  __NEXT_DATA__: {
    props: {
      pageProps: object;
    };
  };
}

const Document = ({ __NEXT_DATA__ }: DocumentProps) => {
  const hasPageProps = __NEXT_DATA__.props.pageProps !== undefined;
  return (
    <Html lang="en">
      <Head />
      <body>
        <Main />
        <NextScript />
        {hasPageProps && <div className="tooltips" />}
      </body>
    </Html>
  );
};

export default Document;
