import { getBadgeResponse, getDownloads } from "../../../../lib/npm-badges";

export const GET = () => getBadgeResponse("downloads", getDownloads);
