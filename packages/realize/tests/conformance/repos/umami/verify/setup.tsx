import "chartjs-adapter-date-fns";
import { setConfig, setUser } from "@/store/app";

setUser({ id: "user-1", username: "admin", role: "admin", isAdmin: true, teams: [] });
setConfig({
  cloudMode: false,
  privateMode: false,
  sessionDeletionEnabled: true,
  telemetryDisabled: true,
  updatesDisabled: true,
});
