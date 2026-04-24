import { expect } from "@playwright/test";
import { test } from "../../fixtures/test";
import { uniqueName } from "../../utils/test-data";

test("chat-created reminder matches the UI after refresh", async ({ dashboardPage, page }) => {
  const title = uniqueName("Chat Reminder");

  await dashboardPage.goto();
  await dashboardPage.sendChatMessage(`Create reminder ${title} tomorrow 7 PM`);
  const assistantMessage = await dashboardPage.assistantMessageMatching(
    new RegExp(`Reminder "${title}" created`, "i"),
  );
  await expect(assistantMessage).toContainText(`Reminder "${title}" created`);

  const reminderCard = await dashboardPage.expectReminderVisible(title, "tomorrow", "Upcoming");
  await expect(reminderCard).toContainText("Repeat: none");

  await dashboardPage.reloadAndRestoreReminderTab("tomorrow");
  await dashboardPage.expectReminderVisible(title, "tomorrow", "Upcoming");
});
