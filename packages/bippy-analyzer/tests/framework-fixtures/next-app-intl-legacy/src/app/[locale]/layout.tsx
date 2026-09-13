import { NextIntlClientProvider, useMessages } from "next-intl";
import { unstable_setRequestLocale } from "next-intl/server";
import { Greeting } from "@/components/greeting";

export default function RootLayout(props: {
  children: React.ReactNode;
  params: { locale: string };
}) {
  unstable_setRequestLocale(props.params.locale);
  const messages = useMessages();
  return (
    <html lang={props.params.locale}>
      <body>
        <NextIntlClientProvider locale={props.params.locale} messages={messages}>
          {props.children}
          <Greeting name="Ada" />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
