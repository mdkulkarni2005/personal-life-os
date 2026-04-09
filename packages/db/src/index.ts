export type ReminderStatus = "pending" | "done";

export interface ReminderRecord {
  _id: string;
  userId: string;
  title: string;
  notes?: string;
  dueAt: number;
  status: ReminderStatus;
  createdAt: number;
  updatedAt: number;
}

export interface CreateReminderInput {
  title: string;
  notes?: string;
  dueAt: number;
}

export interface UpdateReminderInput {
  reminderId: string;
  title?: string;
  notes?: string;
  dueAt?: number;
  status?: ReminderStatus;
}

export type ReminderListScope = "missed" | "today" | "tomorrow" | "upcoming" | "done" | "all";
