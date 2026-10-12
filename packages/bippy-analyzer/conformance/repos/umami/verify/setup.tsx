import { setConfig, setUser } from "@/store/app";

// The app loads these from its API once a user logs in, and its pages read them right away.
setUser({ id: "user-1", username: "admin", role: "admin", isAdmin: true, teams: [] });
setConfig({
  cloudMode: false,
  privateMode: false,
  sessionDeletionEnabled: true,
  telemetryDisabled: true,
  updatesDisabled: true,
});
