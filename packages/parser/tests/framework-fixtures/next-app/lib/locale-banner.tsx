import { cookies, headers } from "next/headers";

export const LocaleBanner = async () => {
  const locale = (await cookies()).get("Preferred-Locale")?.value ?? "none";
  const requestHeaders = await headers();
  return (
    <p>
      {locale}
      <br />
      {requestHeaders.get("x-locale") ?? "none"}
      <br />
      {requestHeaders.get("host")}
    </p>
  );
};
