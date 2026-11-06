import { configure } from "@testing-library/react";

// The same reason as testTimeout in vite.config.mjs: Testing Library's 1 s
// default wait failed whole-App journeys on a loaded machine. Only a test
// that is really going to fail waits the longer time.
configure({ asyncUtilTimeout: 5000 });
