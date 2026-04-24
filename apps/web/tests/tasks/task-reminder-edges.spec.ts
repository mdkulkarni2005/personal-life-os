import { expect, type Locator } from "@playwright/test";
import { test } from "../../fixtures/test";
import { formatDateInput, formatTimeInput, offsetDate, uniqueName } from "../../utils/test-data";

test.describe("Task and reminder edge cases", () => {
  async function removeNativeMin(locator: Locator) {
    await locator.evaluate((input) => {
      (input as HTMLInputElement).removeAttribute("min");
    });
  }

  function tomorrowAt(hour: number) {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    date.setHours(hour, 0, 0, 0);
    return date;
  }

  test("deleting a task with pending reminders warns first and preserves reminders as ADHOC", async ({
    dashboardPage,
    page,
  }) => {
    const taskTitle = uniqueName("Delete Task");
    const reminderTitle = `${taskTitle} Reminder`;

    await dashboardPage.goto();
    await dashboardPage.createTask({
      title: taskTitle,
      dueAt: offsetDate(new Date(), { days: 1, hours: 1 }),
      notes: "Task delete warning coverage.",
      priority: 4,
      domain: "career",
    });
    await dashboardPage.createReminder({
      title: reminderTitle,
      dueAt: offsetDate(new Date(), { days: 1, hours: 2 }),
      notes: "Linked reminder that must survive task deletion.",
      priority: 3,
      recurrence: "daily",
      taskTitle,
    });

    await dashboardPage.requestTaskDelete(taskTitle);
    await dashboardPage.expectTaskWarning();
    await expect(page.getByTestId("task-warning-text")).toContainText("will unlink");
    await dashboardPage.confirmTaskWarning();

    await dashboardPage.expectTaskAbsent(taskTitle, "pending");
    const card = await dashboardPage.expectReminderVisible(reminderTitle, "tomorrow", "Upcoming");
    await expect(card).toContainText("ADHOC");
    await dashboardPage.reloadAndRestoreReminderTab("tomorrow");
    await dashboardPage.expectReminderVisible(reminderTitle, "tomorrow", "Upcoming");
  });

  test("closing a task with incomplete reminders requires confirmation", async ({
    dashboardPage,
  }) => {
    const taskTitle = uniqueName("Close Task");
    const reminderTitle = `${taskTitle} Reminder`;

    await dashboardPage.goto();
    await dashboardPage.createTask({
      title: taskTitle,
      dueAt: offsetDate(new Date(), { days: 1, hours: 3 }),
      notes: "Task completion warning coverage.",
      priority: 5,
      domain: "health",
    });
    await dashboardPage.createReminder({
      title: reminderTitle,
      dueAt: offsetDate(new Date(), { days: 1, hours: 4 }),
      notes: "Reminder kept incomplete while the task is closed.",
      priority: 4,
      recurrence: "weekly",
      taskTitle,
    });

    await dashboardPage.requestTaskCompletion(taskTitle);
    await dashboardPage.expectTaskWarning();
    await dashboardPage.cancelTaskWarning();
    await dashboardPage.expectTaskVisible(taskTitle, "pending");

    await dashboardPage.requestTaskCompletion(taskTitle);
    await dashboardPage.confirmTaskWarning();
    await dashboardPage.expectTaskVisible(taskTitle, "done");
    await dashboardPage.reloadAndRestoreReminderTab("tomorrow");
    await dashboardPage.expectReminderVisible(reminderTitle, "tomorrow", "Upcoming");
  });

  test("duplicate reminders are rejected and invalid inputs stay in validation state", async ({
    dashboardPage,
    page,
  }) => {
    const reminderTitle = uniqueName("Duplicate Reminder");
    const dueAt = offsetDate(new Date(), { days: 1, hours: 5 });

    await dashboardPage.goto();
    await dashboardPage.createReminder({
      title: reminderTitle,
      dueAt,
      notes: "Seed reminder used for duplicate validation.",
      priority: 2,
      recurrence: "none",
    });

    await dashboardPage.openCreateReminder();
    await dashboardPage.fillReminderForm({
      title: reminderTitle,
      dueAt,
      notes: "Seed reminder used for duplicate validation.",
      priority: 2,
      recurrence: "none",
    });
    await dashboardPage.submitReminderForm(true);
    await dashboardPage.openReminderTab("tomorrow");
    await expect(page.getByTestId("reminder-card").filter({ hasText: reminderTitle })).toHaveCount(1);

    const invalidDueAt = offsetDate(new Date(), { hours: -2 });
    const reminderForm = page.getByTestId("reminder-form-overlay");
    await dashboardPage.openCreateReminder();
    await dashboardPage.fillReminderForm({
      title: uniqueName("Invalid Reminder"),
      dueAt: offsetDate(new Date(), { days: 1, hours: 1 }),
      notes: "Past dates must be rejected.",
      priority: 3,
      recurrence: "none",
    });
    const dateInput = reminderForm.getByTestId("reminder-date-input");
    const timeInput = reminderForm.getByTestId("reminder-time-input");
    await removeNativeMin(dateInput);
    await removeNativeMin(timeInput);
    await dateInput.fill(formatDateInput(invalidDueAt));
    await timeInput.fill(formatTimeInput(invalidDueAt));
    await reminderForm.locator("form").evaluate((form) => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await expect(page.getByTestId("reminder-form-error")).toContainText("future");
  });

  test("rapid create and delete loops leave no stale reminders behind", async ({
    dashboardPage,
  }) => {
    const base = uniqueName("Rapid Reminder");
    const titles = [1, 2, 3].map((index) => `${base} ${index}`);
    const baseDueAt = tomorrowAt(9);

    await dashboardPage.goto();

    for (const [index, title] of titles.entries()) {
      await dashboardPage.createReminder({
        title,
        dueAt: offsetDate(baseDueAt, { hours: index }),
        notes: `Rapid reminder ${index + 1}.`,
        priority: 3,
        recurrence: "none",
      });
    }

    for (const title of titles) {
      await dashboardPage.deleteReminder(title, "tomorrow");
    }

    await dashboardPage.reloadAndRestoreReminderTab("tomorrow");
    for (const title of titles) {
      await dashboardPage.expectReminderAbsentEverywhere(title);
    }
  });
});
