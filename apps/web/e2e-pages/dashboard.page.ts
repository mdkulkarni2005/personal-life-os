import { expect, type Page } from "@playwright/test";
import { formatDateInput, formatDateTimeLocalInput, formatTimeInput } from "../utils/test-data";

export type ReminderTab =
  | "missed"
  | "today"
  | "tomorrow"
  | "upcoming"
  | "done"
  | "shared"
  | "sent";
export type TaskTab = "missed" | "pending" | "done";

export interface ReminderFormValues {
  title: string;
  dueAt: Date;
  notes?: string;
  priority?: number;
  recurrence?: "none" | "daily" | "weekly" | "monthly";
  taskTitle?: string;
  domain?: "health" | "finance" | "career" | "hobby" | "fun";
}

export interface TaskFormValues {
  title: string;
  dueAt?: Date;
  notes?: string;
  priority?: number;
  domain?: "health" | "finance" | "career" | "hobby" | "fun";
}

const REMINDER_TABS: ReminderTab[] = [
  "missed",
  "today",
  "tomorrow",
  "upcoming",
  "done",
  "shared",
  "sent",
];

export class DashboardPage {
  constructor(private readonly page: Page) {}

  private walkthroughDismissButton() {
    return this.page.getByRole("button", { name: /skip walkthrough/i }).first();
  }

  private reminderListOverlay() {
    return this.page.getByTestId("reminder-list-overlay");
  }

  private reminderListCloseButton() {
    return this.page.getByTestId("reminder-list-close").first();
  }

  private reminderForm() {
    return this.page.getByTestId("reminder-form-overlay");
  }

  private taskListOverlay() {
    return this.page.getByTestId("task-list-overlay");
  }

  private taskPanelCloseButton() {
    return this.page.getByTestId("task-panel-close").first();
  }

  private taskForm() {
    return this.page.getByTestId("task-form-overlay");
  }

  private reminderCards(title: string) {
    return this.page.getByTestId("reminder-card").filter({ hasText: title });
  }

  private reminderCard(title: string) {
    return this.reminderCards(title).first();
  }

  private taskCards(title: string) {
    return this.page.getByTestId("task-card").filter({ hasText: title });
  }

  private taskCard(title: string) {
    return this.taskCards(title).first();
  }

  async goto() {
    await this.page.goto("/dashboard");
    await this.expectLoaded();
  }

  async expectLoaded() {
    await expect(this.page.getByTestId("chat-form")).toBeVisible({ timeout: 30_000 });
    await this.dismissWalkthroughIfVisible();
  }

  async dismissWalkthroughIfVisible() {
    const dismissButton = this.walkthroughDismissButton();
    if (!(await dismissButton.isVisible().catch(() => false))) return;
    await dismissButton.click();
    await expect(dismissButton).toBeHidden({ timeout: 10_000 });
  }

  async closeReminderListIfVisible() {
    const overlay = this.reminderListOverlay();
    if (!(await overlay.isVisible().catch(() => false))) return;
    await this.reminderListCloseButton().click();
    await expect(overlay).toBeHidden({ timeout: 10_000 });
  }

  async closeTaskPanelIfVisible() {
    const taskList = this.taskListOverlay();
    const taskForm = this.taskForm();
    const taskPanelOpen =
      (await taskList.isVisible().catch(() => false)) ||
      (await taskForm.isVisible().catch(() => false));
    if (!taskPanelOpen) return;
    await this.taskPanelCloseButton().click();
    await expect(taskList).toBeHidden({ timeout: 10_000 }).catch(() => undefined);
    await expect(taskForm).toBeHidden({ timeout: 10_000 }).catch(() => undefined);
  }

  async signOut() {
    await this.page.getByTestId("drawer-trigger").click();
    await expect(this.page.getByTestId("app-drawer")).toBeVisible();
    await this.page.getByTestId("drawer-sign-out").click();
    await expect(this.page).toHaveURL(/\/$/, { timeout: 30_000 });
  }

  async openReminders() {
    await this.closeTaskPanelIfVisible();
    const overlay = this.reminderListOverlay();
    if (await overlay.isVisible().catch(() => false)) return;
    await this.page.getByTestId("open-reminders-button").click();
    await expect(overlay).toBeVisible();
  }

  async openReminderTab(tab: ReminderTab) {
    await this.openReminders();
    await this.page.getByTestId(`reminder-tab-${tab}`).click();
  }

  async getReminderTabCount(tab: ReminderTab) {
    await this.openReminders();
    const text = await this.page.getByTestId(`reminder-tab-${tab}`).innerText();
    const match = text.match(/\((\d+)\)/);
    return Number(match?.[1] ?? 0);
  }

  async openCreateReminder() {
    await this.openReminders();
    await this.page.getByTestId("reminder-create-button").click();
    await expect(this.reminderForm()).toBeVisible();
  }

  async fillReminderForm({
    title,
    dueAt,
    notes,
    priority = 3,
    recurrence = "none",
    taskTitle,
    domain,
  }: ReminderFormValues) {
    const overlay = this.reminderForm();
    await overlay.getByTestId("reminder-title-input").fill(title);
    await overlay.getByTestId("reminder-date-input").fill(formatDateInput(dueAt));
    await overlay.getByTestId("reminder-time-input").fill(formatTimeInput(dueAt));
    await overlay.getByRole("button", { name: new RegExp(`^${priority} star`) }).click();
    await overlay.getByTestId("reminder-recurrence-select").selectOption(recurrence);

    if (notes) {
      await overlay.getByTestId("reminder-notes-input").fill(notes);
    }
    if (taskTitle) {
      await overlay.getByTestId("reminder-task-select").selectOption({ label: taskTitle });
    }
    if (domain) {
      await overlay.getByTestId("reminder-domain-select").selectOption(domain);
    }
  }

  async submitReminderForm(expectClose = true, closeTimeout = 30_000) {
    const overlay = this.reminderForm();
    await overlay.getByTestId("reminder-save-button").click();
    if (expectClose) {
      await expect(overlay).toBeHidden({ timeout: closeTimeout });
    }
  }

  async createReminder(values: ReminderFormValues, closeTimeout = 30_000) {
    await this.openCreateReminder();
    await this.fillReminderForm(values);
    await this.submitReminderForm(true, closeTimeout);
  }

  async expectReminderVisible(
    title: string,
    tab: ReminderTab,
    expectedState?: "Done" | "Missed" | "Upcoming",
  ) {
    await this.openReminderTab(tab);
    const card = this.reminderCard(title);
    await expect(card).toBeVisible({ timeout: 30_000 });
    if (expectedState) {
      await expect(card.getByTestId("reminder-state-label")).toHaveText(expectedState);
    }
    return card;
  }

  async findReminderAcrossTabs(title: string, tabs: ReminderTab[] = REMINDER_TABS) {
    for (const tab of tabs) {
      await this.openReminderTab(tab);
      const card = this.reminderCard(title);
      if (await card.isVisible().catch(() => false)) {
        return { tab, card };
      }
    }
    return null;
  }

  async reloadAndRestoreReminderTab(tab: ReminderTab) {
    await this.page.reload();
    await this.expectLoaded();
    await this.openReminderTab(tab);
  }

  async editReminder(
    currentTitle: string,
    currentTab: ReminderTab,
    patch: Partial<ReminderFormValues>,
  ) {
    const card = await this.expectReminderVisible(currentTitle, currentTab);
    await card.getByTestId("reminder-edit-button").click();
    await expect(this.reminderForm()).toBeVisible();

    const overlay = this.reminderForm();
    if (patch.title) {
      await overlay.getByTestId("reminder-title-input").fill(patch.title);
    }
    if (patch.dueAt) {
      await overlay.getByTestId("reminder-date-input").fill(formatDateInput(patch.dueAt));
      await overlay.getByTestId("reminder-time-input").fill(formatTimeInput(patch.dueAt));
    }
    if (patch.notes !== undefined) {
      await overlay.getByTestId("reminder-notes-input").fill(patch.notes);
    }
    if (patch.priority) {
      await overlay.getByRole("button", { name: new RegExp(`^${patch.priority} star`) }).click();
    }
    if (patch.recurrence) {
      await overlay.getByTestId("reminder-recurrence-select").selectOption(patch.recurrence);
    }
    if (patch.taskTitle !== undefined) {
      await overlay
        .getByTestId("reminder-task-select")
        .selectOption(patch.taskTitle ? { label: patch.taskTitle } : { value: "" });
    }
    if (patch.domain !== undefined) {
      await overlay.getByTestId("reminder-domain-select").selectOption(patch.domain || "");
    }
    await this.submitReminderForm(true);
  }

  async markReminderDone(title: string, tab: ReminderTab) {
    const card = await this.expectReminderVisible(title, tab);
    await card.getByTestId("reminder-status-button").click();
  }

  async deleteReminder(title: string, tab: ReminderTab) {
    const card = await this.expectReminderVisible(title, tab);
    await card.getByTestId("reminder-delete-button").click();
  }

  async expectReminderAbsentEverywhere(title: string) {
    await this.openReminders();
    for (const tab of REMINDER_TABS) {
      await this.openReminderTab(tab);
      await expect(this.reminderCards(title)).toHaveCount(0);
    }
  }

  async openTasks() {
    await this.closeReminderListIfVisible();
    const overlay = this.taskListOverlay();
    if (await overlay.isVisible().catch(() => false)) return;
    await this.page.getByRole("button", { name: /all tasks/i }).first().click();
    await expect(overlay).toBeVisible();
  }

  async openTaskTab(tab: TaskTab) {
    await this.openTasks();
    await this.page.getByTestId(`task-tab-${tab}`).click();
  }

  async openCreateTask() {
    await this.openTasks();
    await this.page.getByTestId("task-create-button").click();
    await expect(this.taskForm()).toBeVisible();
  }

  async fillTaskForm({ title, dueAt, notes, priority = 3, domain }: TaskFormValues) {
    const overlay = this.taskForm();
    await overlay.getByTestId("task-title-input").fill(title);
    if (dueAt) {
      await overlay.getByTestId("task-due-input").fill(formatDateTimeLocalInput(dueAt));
    }
    if (notes) {
      await overlay.getByTestId("task-notes-input").fill(notes);
    }
    await overlay.getByRole("button", { name: new RegExp(`^${priority} star`) }).click();
    if (domain) {
      await overlay.getByTestId("task-domain-select").selectOption(domain);
    }
  }

  async saveTaskForm() {
    const overlay = this.taskForm();
    await overlay.getByTestId("task-save-button").click();
    await expect(overlay.getByTestId("task-title-input")).toHaveValue("");
  }

  async createTask(values: TaskFormValues) {
    await this.openCreateTask();
    await this.fillTaskForm(values);
    await this.saveTaskForm();
    await this.taskForm().getByTestId("task-panel-close").click();
    await expect(this.taskForm()).toBeHidden();
  }

  async createTaskBatch(values: TaskFormValues[]) {
    await this.openCreateTask();
    for (const value of values) {
      await this.fillTaskForm(value);
      await this.saveTaskForm();
    }
    await this.taskForm().getByTestId("task-panel-close").click();
    await expect(this.taskForm()).toBeHidden();
  }

  async expectTaskVisible(title: string, tab: TaskTab) {
    await this.openTaskTab(tab);
    const card = this.taskCard(title);
    await expect(card).toBeVisible();
    return card;
  }

  async expectTaskAbsent(title: string, tab: TaskTab) {
    await this.openTaskTab(tab);
    await expect(this.taskCards(title)).toHaveCount(0);
  }

  async countVisibleTaskCards() {
    await this.openTasks();
    return this.page.getByTestId("task-card").count();
  }

  async requestTaskCompletion(title: string, tab: TaskTab = "pending") {
    const card = await this.expectTaskVisible(title, tab);
    await card.getByTestId("task-status-button").click();
  }

  async requestTaskDelete(title: string, tab: TaskTab = "pending") {
    const card = await this.expectTaskVisible(title, tab);
    await card.getByTestId("task-delete-button").click();
  }

  async expectTaskWarning() {
    await expect(this.page.getByTestId("task-warning-modal")).toBeVisible();
  }

  async confirmTaskWarning() {
    await this.expectTaskWarning();
    await this.page.getByTestId("task-warning-confirm").click();
    await expect(this.page.getByTestId("task-warning-modal")).toBeHidden();
  }

  async cancelTaskWarning() {
    await this.expectTaskWarning();
    await this.page.getByTestId("task-warning-cancel").click();
    await expect(this.page.getByTestId("task-warning-modal")).toBeHidden();
  }

  async sendChatMessage(message: string) {
    await this.closeReminderListIfVisible();
    await this.closeTaskPanelIfVisible();
    await this.page.getByTestId("chat-input").fill(message);
    await this.page.getByTestId("chat-send-button").click();
    await expect(
      this.page
        .locator('[data-testid="chat-message"][data-message-role="user"]')
        .filter({ hasText: message })
        .last(),
    ).toBeVisible();
  }

  async assistantMessageMatching(pattern: string | RegExp) {
    const locator = this.page
      .locator('[data-testid="chat-message"][data-message-role="assistant"]')
      .filter({ hasText: pattern })
      .last();
    await expect(locator).toBeVisible({ timeout: 20_000 });
    return locator;
  }

  async waitForDueReminder(title: string) {
    const locator = this.page
      .locator('[data-testid="chat-message"][data-message-role="assistant"]')
      .filter({ hasText: /Reminder due/i })
      .filter({ hasText: title })
      .last();
    await expect(locator).toBeVisible({ timeout: 20_000 });
    return locator;
  }

  async runDueAction(
    title: string,
    action: "done" | "snooze" | "reschedule" | "delete",
    rescheduleDate?: Date,
  ) {
    const bubble = await this.waitForDueReminder(title);
    const buttonByAction: Record<string, string> = {
      done: "due-reminder-done-button",
      snooze: "due-reminder-snooze-button",
      reschedule: "due-reminder-reschedule-button",
      delete: "due-reminder-delete-button",
    };

    await bubble.getByTestId(buttonByAction[action]!).click();

    if (action === "reschedule" && rescheduleDate) {
      const modal = this.page.getByTestId("reschedule-reminder-modal");
      await expect(modal).toBeVisible();
      await modal
        .getByTestId("reschedule-datetime-input")
        .fill(formatDateTimeLocalInput(rescheduleDate));
      await modal.getByTestId("reschedule-save-button").click();
      await expect(modal).toBeHidden();
    }
  }
}
