import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup, configure } from '@testing-library/react';

// Without Vitest globals Testing Library cannot register its own cleanup, so each test
// would see the screens the previous ones rendered.
afterEach(cleanup);

// Testing Library waits one second by default for something to appear. A role query over a whole
// screen is slow in jsdom, and the files of the suite run side by side on a modest PC: a screen that
// is perfectly fine took more than a second to be found, now and then (a spec that had passed every
// run before failed in two full runs out of four). A wait that succeeds ends the moment it does, so
// the longer limit costs nothing but a failure that takes longer to report.
configure({ asyncUtilTimeout: 4000 });
