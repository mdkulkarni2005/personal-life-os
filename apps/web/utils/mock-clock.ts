import type { Page } from "@playwright/test";

const TEST_CLOCK_STORAGE_KEY = "remindos:testClockIso";

declare global {
  interface Window {
    __remindosTestClock?: {
      set: (nextIso: string) => void;
      now: () => number;
    };
  }
}

export async function installMockClock(page: Page, startAt: Date) {
  await page.addInitScript(({ iso, storageKey }) => {
    const RealDate = Date;
    const readStoredIso = () => {
      try {
        return window.localStorage.getItem(storageKey);
      } catch {
        return null;
      }
    };
    const persistIso = (nextIso: string) => {
      try {
        window.localStorage.setItem(storageKey, nextIso);
      } catch {
        /* ignore */
      }
    };

    let fixedNow = new RealDate(readStoredIso() ?? iso).valueOf();
    persistIso(new RealDate(fixedNow).toISOString());

    class MockDate extends RealDate {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      constructor(...args: any[]) {
        if (args.length === 0) {
          super(fixedNow);
          return;
        }
        if (args.length === 1) {
          super(args[0]);
          return;
        }
        if (args.length === 2) {
          super(args[0], args[1]);
          return;
        }
        if (args.length === 3) {
          super(args[0], args[1], args[2]);
          return;
        }
        if (args.length === 4) {
          super(args[0], args[1], args[2], args[3]);
          return;
        }
        if (args.length === 5) {
          super(args[0], args[1], args[2], args[3], args[4]);
          return;
        }
        if (args.length === 6) {
          super(args[0], args[1], args[2], args[3], args[4], args[5]);
          return;
        }
        super(args[0], args[1], args[2], args[3], args[4], args[5], args[6]);
      }

      static now() {
        return fixedNow;
      }
    }

    MockDate.parse = RealDate.parse;
    MockDate.UTC = RealDate.UTC;
    Object.setPrototypeOf(MockDate, RealDate);

    window.__remindosTestClock = {
      set: (nextIso: string) => {
        fixedNow = new RealDate(nextIso).valueOf();
        persistIso(new RealDate(fixedNow).toISOString());
      },
      now: () => fixedNow,
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).Date = MockDate;
  }, { iso: startAt.toISOString(), storageKey: TEST_CLOCK_STORAGE_KEY });
}

export async function setMockClock(page: Page, nextAt: Date) {
  await page.evaluate((iso) => {
    window.__remindosTestClock?.set(iso);
  }, nextAt.toISOString());
}
