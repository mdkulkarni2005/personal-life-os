"use client";

import type { FormEvent } from "react";
import type { LifeDomain, ReminderItem } from "@repo/reminder";
import { StarRating, priorityStarsLabel } from "./star-rating";

export interface TaskRow {
  id: string;
  title: string;
  notes?: string;
  dueAt?: string;
  status: "pending" | "done";
  priority?: number;
  domain?: LifeDomain;
}

export interface TaskGroups {
  missed: TaskRow[];
  pending: TaskRow[];
  done: TaskRow[];
}

interface TaskListOverlayProps {
  open: boolean;
  taskTab: "missed" | "pending" | "done";
  setTaskTab: (tab: "missed" | "pending" | "done") => void;
  tasksGrouped: TaskGroups;
  reminders: ReminderItem[];
  onClose: () => void;
  onViewReminders: () => void;
  onCreateTask: () => void;
  onEditTask: (task: TaskRow) => void;
  onToggleStatus: (task: TaskRow) => void;
  onDeleteTask: (task: TaskRow) => void;
}

interface TaskFormOverlayProps {
  open: boolean;
  editingTaskId: string | null;
  taskFormTitle: string;
  setTaskFormTitle: (value: string) => void;
  taskFormDue: string;
  setTaskFormDue: (value: string) => void;
  taskFormNotes: string;
  setTaskFormNotes: (value: string) => void;
  taskFormDomain: "" | LifeDomain;
  setTaskFormDomain: (value: "" | LifeDomain) => void;
  taskStars: number;
  setTaskStars: (value: number) => void;
  taskFormError: string | null;
  taskDueUserEdited: boolean;
  setTaskDueUserEdited: (value: boolean) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancelEdit: () => void;
  onClose: () => void;
  onViewReminders: () => void;
  onCreateLinkedReminder: () => void;
}

function formatTaskDate(iso?: string) {
  if (!iso) return null;
  return new Date(iso).toLocaleString();
}

function TaskHeader({
  title,
  description,
  onViewReminders,
  onClose,
}: {
  title: string;
  description?: string;
  onViewReminders: () => void;
  onClose: () => void;
}) {
  return (
    <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
      <div>
        <h3 className="text-base font-semibold sm:text-lg">{title}</h3>
        {description ? (
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {description}
          </p>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onViewReminders}
          className="rounded-full border border-violet-300 bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-900 transition hover:bg-violet-100 dark:border-violet-700 dark:bg-violet-950/50 dark:text-violet-100 dark:hover:bg-violet-900/40"
        >
          View reminders
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold dark:border-slate-600"
        >
          Close
        </button>
      </div>
    </div>
  );
}

function TaskListCard({
  task,
  reminders,
  onEditTask,
  onToggleStatus,
  onDeleteTask,
}: {
  task: TaskRow;
  reminders: ReminderItem[];
  onEditTask: (task: TaskRow) => void;
  onToggleStatus: (task: TaskRow) => void;
  onDeleteTask: (task: TaskRow) => void;
}) {
  const linkedAll = reminders.filter((r) => r.linkedTaskId === task.id);
  const linkedPending = linkedAll.filter((r) => r.status === "pending");
  const linkedDone = linkedAll.filter(
    (r) => r.status === "done" || r.status === "archived",
  );

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <p className="font-semibold text-slate-950 dark:text-slate-100">
        {task.title}
        <span className="text-amber-500">{priorityStarsLabel(task.priority)}</span>
        {task.domain ? (
          <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-100">
            {task.domain}
          </span>
        ) : null}
      </p>
      {task.dueAt ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {task.status === "done" ? "Completed due: " : "Due: "}
          {formatTaskDate(task.dueAt)}
        </p>
      ) : (
        <p className="text-sm text-slate-500 dark:text-slate-400">No due date</p>
      )}
      {task.notes ? (
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          {task.notes}
        </p>
      ) : null}
      {linkedAll.length > 0 ? (
        <div className="mt-2 space-y-2">
          {linkedPending.length > 0 ? (
            <div className="rounded-xl border border-violet-200/90 bg-gradient-to-b from-violet-50/95 to-white px-2.5 py-2 dark:border-violet-800/80 dark:from-violet-950/50 dark:to-slate-900/90">
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-violet-800 dark:text-violet-200">
                Linked reminders
              </p>
              <ul className="space-y-1.5">
                {linkedPending.map((r) => (
                  <li
                    key={r.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/70 bg-white/90 px-2 py-1.5 text-xs shadow-sm dark:border-slate-700 dark:bg-slate-900/90"
                  >
                    <span className="min-w-0 font-medium text-slate-900 dark:text-slate-100">
                      {r.title}
                    </span>
                    <span className="shrink-0 text-[11px] text-slate-500 dark:text-slate-400">
                      {new Date(r.dueAt).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {linkedDone.length > 0 ? (
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              <span className="font-medium text-slate-600 dark:text-slate-300">
                Completed on this task:
              </span>{" "}
              {linkedDone.map((r) => r.title).join(" · ")}
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onEditTask(task)}
          className="rounded-full bg-amber-500 px-3 py-1 text-xs font-semibold text-white"
        >
          Edit
        </button>
        {task.status === "pending" ? (
          <button
            type="button"
            onClick={() => onToggleStatus(task)}
            className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-semibold text-white"
          >
            Mark done
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onToggleStatus(task)}
            className="rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold dark:border-slate-600"
          >
            Reopen
          </button>
        )}
        <button
          type="button"
          onClick={() => onDeleteTask(task)}
          className="rounded-full bg-rose-600 px-3 py-1 text-xs font-semibold text-white"
        >
          Delete
        </button>
      </div>
    </article>
  );
}

export function TaskListOverlay({
  open,
  taskTab,
  setTaskTab,
  tasksGrouped,
  reminders,
  onClose,
  onViewReminders,
  onCreateTask,
  onEditTask,
  onToggleStatus,
  onDeleteTask,
}: TaskListOverlayProps) {
  if (!open) return null;

  const activeTasks =
    taskTab === "missed"
      ? tasksGrouped.missed
      : taskTab === "pending"
        ? tasksGrouped.pending
        : tasksGrouped.done;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="tasks-list-title"
        className="mt-auto flex max-h-[min(92vh,760px)] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900 sm:my-auto sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <TaskHeader
          title="Tasks"
          onViewReminders={onViewReminders}
          onClose={onClose}
        />
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-4 py-2 dark:border-slate-800">
          <div className="flex gap-1 overflow-x-auto">
            {(
              [
                ["missed", "Missed"],
                ["pending", "Upcoming"],
                ["done", "Done"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTaskTab(key)}
                className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                  taskTab === key
                    ? "bg-teal-600 text-white"
                    : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                }`}
              >
                {label}{" "}
                <span className="opacity-80">
                  (
                  {key === "missed"
                    ? tasksGrouped.missed.length
                    : key === "pending"
                      ? tasksGrouped.pending.length
                      : tasksGrouped.done.length}
                  )
                </span>
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onCreateTask}
            className="rounded-full border border-teal-300 bg-teal-50 px-3 py-1 text-xs font-semibold text-teal-800 transition hover:bg-teal-100 dark:border-teal-700 dark:bg-teal-950/50 dark:text-teal-100 dark:hover:bg-teal-900/40"
          >
            + Task
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="grid gap-3">
            {activeTasks.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                No tasks here.
              </p>
            ) : (
              activeTasks.map((task) => (
                <TaskListCard
                  key={task.id}
                  task={task}
                  reminders={reminders}
                  onEditTask={onEditTask}
                  onToggleStatus={onToggleStatus}
                  onDeleteTask={onDeleteTask}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function TaskFormOverlay({
  open,
  editingTaskId,
  taskFormTitle,
  setTaskFormTitle,
  taskFormDue,
  setTaskFormDue,
  taskFormNotes,
  setTaskFormNotes,
  taskFormDomain,
  setTaskFormDomain,
  taskStars,
  setTaskStars,
  taskFormError,
  taskDueUserEdited,
  setTaskDueUserEdited,
  onSubmit,
  onCancelEdit,
  onClose,
  onViewReminders,
  onCreateLinkedReminder,
}: TaskFormOverlayProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="tasks-form-title"
        className="mt-auto flex max-h-[min(92vh,760px)] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900 sm:my-auto sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <TaskHeader
          title={editingTaskId ? "Edit task" : "Create task"}
          onViewReminders={onViewReminders}
          onClose={onClose}
        />
        <form className="min-h-0 overflow-y-auto" onSubmit={onSubmit}>
          <div className="grid gap-4 px-4 py-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                {editingTaskId ? "Edit task" : "New task"}
              </p>
              {editingTaskId ? (
                <button
                  type="button"
                  className="text-xs font-semibold text-slate-500 underline hover:text-slate-700 dark:hover:text-slate-300"
                  onClick={onCancelEdit}
                >
                  Cancel edit
                </button>
              ) : null}
            </div>
            <input
              value={taskFormTitle}
              onChange={(e) => setTaskFormTitle(e.target.value)}
              placeholder="Title"
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-950"
            />
            <StarRating
              value={taskStars}
              onChange={setTaskStars}
              label="Priority (required)"
            />
            <label className="grid gap-1 text-xs font-medium text-slate-600 dark:text-slate-400">
              <span>Due date &amp; time (optional)</span>
              <input
                type="datetime-local"
                min={new Date().toISOString().slice(0, 16)}
                value={taskFormDue}
                onFocus={() => setTaskDueUserEdited(true)}
                onChange={(e) => {
                  setTaskDueUserEdited(true);
                  setTaskFormDue(e.target.value);
                }}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-950 dark:[color-scheme:dark]"
              />
            </label>
            <textarea
              value={taskFormNotes}
              onChange={(e) => setTaskFormNotes(e.target.value)}
              placeholder="Notes (optional)"
              rows={2}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-950"
            />
            <label className="grid gap-1 text-xs font-medium text-slate-600 dark:text-slate-400">
              Domain (optional)
              <select
                value={taskFormDomain}
                onChange={(e) => setTaskFormDomain(e.target.value as "" | LifeDomain)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-950"
              >
                <option value="">No domain</option>
                {(["health", "finance", "career", "hobby", "fun"] as const).map(
                  (d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ),
                )}
              </select>
            </label>
            <button
              type="button"
              onClick={onCreateLinkedReminder}
              className="w-full rounded-xl border border-violet-300 bg-violet-50/90 py-2 text-xs font-semibold text-violet-900 shadow-sm transition hover:bg-violet-100 dark:border-violet-700 dark:bg-violet-950/50 dark:text-violet-100 dark:hover:bg-violet-900/40"
            >
              + Add linked reminder
            </button>
            {taskFormError ? (
              <p className="text-xs text-rose-600 dark:text-rose-400">
                {taskFormError}
              </p>
            ) : null}
            <button
              type="submit"
              className="w-full rounded-full bg-teal-600 py-2 text-sm font-semibold text-white hover:bg-teal-500"
            >
              {editingTaskId ? "Save changes" : "Add task"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
