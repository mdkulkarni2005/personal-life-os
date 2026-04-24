import { expect } from "@playwright/test";
import { test } from "../../fixtures/test";
import { offsetDate, uniqueName } from "../../utils/test-data";

test("reminder CRUD stays consistent across refreshes", async ({ dashboardPage }) => {
  const originalTitle = uniqueName("Reminder CRUD");
  const editedTitle = `${originalTitle} Edited`;
  const initialDueAt = offsetDate(new Date(), { days: 1, hours: 1 });
  const updatedDueAt = offsetDate(initialDueAt, { hours: 2 });

  await dashboardPage.goto();

  await dashboardPage.createReminder({
    title: originalTitle,
    dueAt: initialDueAt,
    notes: "Initial reminder notes for the CRUD regression.",
    priority: 4,
    recurrence: "weekly",
    domain: "finance",
  });

  let card = await dashboardPage.expectReminderVisible(originalTitle, "tomorrow", "Upcoming");
  await expect(card).toContainText("Repeat: weekly");
  await expect(card).toContainText("Initial reminder notes for the CRUD regression.");

  await dashboardPage.reloadAndRestoreReminderTab("tomorrow");
  card = await dashboardPage.expectReminderVisible(originalTitle, "tomorrow", "Upcoming");
  await expect(card).toContainText("finance");

  await dashboardPage.editReminder(originalTitle, "tomorrow", {
    title: editedTitle,
    dueAt: updatedDueAt,
    notes: "Edited reminder notes after the update path.",
    priority: 5,
    recurrence: "monthly",
    domain: "career",
  });

  card = await dashboardPage.expectReminderVisible(editedTitle, "tomorrow", "Upcoming");
  await expect(card).toContainText("Repeat: monthly");
  await expect(card).toContainText("Edited reminder notes after the update path.");
  await expect(card).toContainText("career");

  await dashboardPage.reloadAndRestoreReminderTab("tomorrow");
  await dashboardPage.expectReminderVisible(editedTitle, "tomorrow", "Upcoming");

  await dashboardPage.deleteReminder(editedTitle, "tomorrow");
  await dashboardPage.expectReminderAbsentEverywhere(editedTitle);

  await dashboardPage.reloadAndRestoreReminderTab("tomorrow");
  await dashboardPage.expectReminderAbsentEverywhere(editedTitle);
});
