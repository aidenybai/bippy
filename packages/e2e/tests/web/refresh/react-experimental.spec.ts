// The same ported ReactFresh suite against the React experimental channel
// (nightlies from facebook/react main) through the refresh-app-experimental
// fixture. This is bippy's early-warning system for internals changes, and
// it validates the known-issue annotations: kind-changing edits
// (facebook/react#36950/#36964) must pass here and on React 19.3 while
// still failing on React 17/18.
import { defineRefreshSuite } from "./refresh-suite";

defineRefreshSuite(99, "React experimental");
