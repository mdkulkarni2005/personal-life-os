import { expect } from "@playwright/test";
import { test } from "../../fixtures/test";
import { installMockClock, setMockClock } from "../../utils/mock-clock";
import { offsetDate, uniqueName } from "../../utils/test-data";

test.describe.serial("Reminder state transitions", () => {
  test("upcoming reminders move through due, missed, done, reschedule, and skip flows", async ({
    dashboardPage,
    page,
  }) => {
    const baseNow = offsetDate(new Date(), { minutes: 2 });
    await installMockClock(page, baseNow);

    const doneTitle = uniqueName("Due Done");
    const rescheduleTitle = uniqueName("Due Reschedule");
    const snoozeTitle = uniqueName("Due Skip");
    const missedTitle = uniqueName("Due Missed");

    const doneDueAt = offsetDate(baseNow, { hours: 1 });
    const rescheduleDueAt = offsetDate(baseNow, { hours: 2 });
    const snoozeDueAt = offsetDate(baseNow, { hours: 3 });
    const missedDueAt = offsetDate(baseNow, { hours: 4 });
    const rescheduledTime = offsetDate(baseNow, { hours: 6 });

    await dashboardPage.goto();

    for (const entry of [
      { title: doneTitle, dueAt: doneDueAt },
      { title: rescheduleTitle, dueAt: rescheduleDueAt },
      { title: snoozeTitle, dueAt: snoozeDueAt },
      { title: missedTitle, dueAt: missedDueAt },
    ]) {
      await dashboardPage.createReminder({
        title: entry.title,
        dueAt: entry.dueAt,
        notes: `State transition fixture for ${entry.title}.`,
        priority: 3,
        recurrence: "none",
      });
    }

    await dashboardPage.expectReminderVisible(doneTitle, "today", "Upcoming");
    await dashboardPage.expectReminderVisible(rescheduleTitle, "today", "Upcoming");
    await dashboardPage.expectReminderVisible(snoozeTitle, "today", "Upcoming");
    await dashboardPage.expectReminderVisible(missedTitle, "today", "Upcoming");

    await setMockClock(page, doneDueAt);
    await page.reload();
    await dashboardPage.expectLoaded();
    await dashboardPage.runDueAction(doneTitle, "done");
    await dashboardPage.expectReminderVisible(doneTitle, "done", "Done");
    await dashboardPage.reloadAndRestoreReminderTab("done");
    await dashboardPage.expectReminderVisible(doneTitle, "done", "Done");

    await setMockClock(page, rescheduleDueAt);
    await page.reload();
    await dashboardPage.expectLoaded();
    await dashboardPage.runDueAction(rescheduleTitle, "reschedule", rescheduledTime);
    let card = await dashboardPage.expectReminderVisible(rescheduleTitle, "today", "Upcoming");
    await expect(card).toContainText("Due:");
    await dashboardPage.reloadAndRestoreReminderTab("today");
    await dashboardPage.expectReminderVisible(rescheduleTitle, "today", "Upcoming");

    await setMockClock(page, snoozeDueAt);
    await page.reload();
    await dashboardPage.expectLoaded();
    await dashboardPage.runDueAction(snoozeTitle, "snooze");
    card = await dashboardPage.expectReminderVisible(snoozeTitle, "today", "Upcoming");
    await expect(card).toContainText("Due:");
    await dashboardPage.reloadAndRestoreReminderTab("today");
    await dashboardPage.expectReminderVisible(snoozeTitle, "today", "Upcoming");

    await setMockClock(page, offsetDate(missedDueAt, { hours: 2 }));
    await page.reload();
    await dashboardPage.expectLoaded();
    await dashboardPage.expectReminderVisible(missedTitle, "missed", "Missed");
  });
});
