import { listExamples } from "@/server/examples";
import { ClientApp } from "./client-app";

export const dynamic = "force-dynamic";

const Page = () => <ClientApp examples={listExamples()} />;

export default Page;
