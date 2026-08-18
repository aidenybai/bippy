// Drives the browser port of facebook/react's ReactFresh-test.js suite
// (see fixtures/refresh-app/src/scenarios) against React 19. Every
// scenario runs on a fresh page so react-refresh runtime state never
// leaks between tests, with bippy installed before React.
import { defineRefreshSuite } from "./refresh-suite";

defineRefreshSuite(19);
