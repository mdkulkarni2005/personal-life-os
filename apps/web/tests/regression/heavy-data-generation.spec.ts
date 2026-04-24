import { expect } from "@playwright/test";
import { test } from "../../fixtures/test";
import { buildTaskReminderMatrix, offsetDate } from "../../utils/test-data";

test.describe.serial("Heavy data generation", () => {
  test("creates a dense task and reminder matrix through the UI", async ({
    dashboardPage,
  }) => {
    test.slow();

    const matrix = buildTaskReminderMatrix(offsetDate(new Date(), { hours: 2 }))
      .slice(0, 6)
      .map((row) => ({
        ...row,
        reminders: row.reminders.slice(0, 10),
      }));
    const expectedReminderCount = matrix.reduce((count, row) => count + row.reminders.length, 0);

    await dashboardPage.goto();
    await dashboardPage.createTaskBatch(
      matrix.map((row) => ({
        title: row.task.title,
        dueAt: row.task.dueAt,
        notes: row.task.notes,
        priority: row.task.priority,
        domain: row.task.domain,
      })),
    );

    for (const row of matrix) {
      for (const reminder of row.reminders) {
        await dashboardPage.createReminder({
          title: reminder.title,
          dueAt: reminder.dueAt,
          notes: reminder.notes,
          priority: reminder.priority,
          recurrence: reminder.recurrence,
          taskTitle: row.task.title,
          domain: reminder.domain,
        }, 90_000);
      }
    }

    await dashboardPage.openTaskTab("pending");
    expect(await dashboardPage.countVisibleTaskCards()).toBeGreaterThanOrEqual(matrix.length);

    const totalVisibleReminderCount =
      (await dashboardPage.getReminderTabCount("today")) +
      (await dashboardPage.getReminderTabCount("tomorrow")) +
      (await dashboardPage.getReminderTabCount("upcoming"));
    expect(totalVisibleReminderCount).toBeGreaterThanOrEqual(expectedReminderCount);

    const firstRow = matrix[0]!;
    const lastRow = matrix[matrix.length - 1]!;
    const firstReminder = firstRow.reminders[0]!;
    const lastReminder = lastRow.reminders[lastRow.reminders.length - 1]!;

    const firstLocated = await dashboardPage.findReminderAcrossTabs(firstReminder.title, [
      "today",
      "tomorrow",
      "upcoming",
    ]);
    const lastLocated = await dashboardPage.findReminderAcrossTabs(lastReminder.title, [
      "today",
      "tomorrow",
      "upcoming",
    ]);

    expect(firstLocated).not.toBeNull();
    expect(lastLocated).not.toBeNull();
    await dashboardPage.openReminderTab(firstLocated!.tab);
    await expect(firstLocated!.card).toContainText("Task:");
    await dashboardPage.openReminderTab(lastLocated!.tab);
    await expect(lastLocated!.card).toContainText("Task:");
  });
});
