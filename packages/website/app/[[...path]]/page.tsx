import { redirect } from "next/navigation";

const GITHUB_URL = "https://github.com/aidenybai/bippy";

const Page = () => {
  redirect(GITHUB_URL);
};

export default Page;
