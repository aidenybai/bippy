// The same ported ReactFresh suite against the React experimental channel
// (nightlies from facebook/react main) through the refresh-app-experimental
// fixture. This is bippy's early-warning system for internals changes, and
// it validates the known-issue annotations: kind-changing edits are fixed
// on main (facebook/react#36950/#36964), so those scenarios must pass here
// while still failing on every released major.
import { defineRefreshSuite } from "./refresh-suite";

defineRefreshSuite(99);
