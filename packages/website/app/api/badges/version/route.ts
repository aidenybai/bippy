import { getBadgeResponse, getVersion } from "../../../../lib/npm-badges";

export const GET = () => getBadgeResponse("npm", getVersion);
