import { TASK_REMINDER_OFFSET_OPTIONS } from "@/lib/notifications/labels";

/**
 * Reminder checkboxes for task forms (submitted as repeated
 * `reminderOffsetsMinutes`). With none selected, a task with a due date
 * still gets the default one-day-before in-app reminder.
 */
export function TaskReminderOffsetsField({ idPrefix, defaultOffsets = [] }: { idPrefix: string; defaultOffsets?: number[] }) {
  return (
    <fieldset className="space-y-1">
      <legend className="text-xs font-medium">In-app reminders</legend>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {TASK_REMINDER_OFFSET_OPTIONS.map((option) => (
          <label key={option.minutes} htmlFor={`${idPrefix}-${option.minutes}`} className="flex items-center gap-1 text-xs">
            <input
              id={`${idPrefix}-${option.minutes}`}
              type="checkbox"
              name="reminderOffsetsMinutes"
              value={option.minutes}
              defaultChecked={defaultOffsets.includes(option.minutes)}
            />
            {option.label}
          </label>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">Default when none selected: 1 day before the due date.</p>
    </fieldset>
  );
}
