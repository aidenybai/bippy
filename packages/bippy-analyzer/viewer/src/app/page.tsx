import { StartPage } from "@/components/start/start-page";
import { demos } from "@/server/demos";

const Page = () => <StartPage examples={demos.examples} />;

export default Page;
