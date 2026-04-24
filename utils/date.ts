import { formatLocalDateKey } from "./schedule.js";

export const getMonthState = (offset: number) => {
  const now = new Date();
  const targetMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  targetMonth.setMonth(targetMonth.getMonth() + offset);

  return {
    year: targetMonth.getFullYear(),
    month: targetMonth.getMonth(),
    today: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
  };
};

export const calendar: Record<string, { isBlocked: boolean }> = {};

export function buildDate(
  year: number,
  month: number,
  mode: "admin" | "user",
  serviceId?: string,
  hiddenDateKeys?: Set<string>,
) {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();
  const weekdays = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
  const keyboard: any[] = [];

  keyboard.push(
    weekdays.map((day) => ({
      text: day,
      callback_data: "noop",
    })),
  );

  let row: any[] = [];

  let startDay = firstDay.getDay();
  startDay = startDay === 0 ? 7 : startDay;

  for (let index = 1; index < startDay; index++) {
    row.push({ text: " ", callback_data: "noop" });
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day);
    const dateKey = formatLocalDateKey(date);

    const isBlocked = calendar[dateKey]?.isBlocked ?? false;
    const isPast = date < today;
    const isHidden = hiddenDateKeys?.has(dateKey) ?? false;
    const isUnavailableForUser =
      mode === "user" && (isPast || isBlocked || isHidden);

    row.push(
      isUnavailableForUser
        ? { text: " ", callback_data: "noop" }
        : {
            text: mode === "admin" ? `${day} ${isBlocked ? "🔴" : "🟢"}` : `${day}`,
            callback_data:
              mode === "admin"
                ? `admin_toggle_${dateKey}`
                : `select_date_${dateKey}_${serviceId}`,
          },
    );

    if (row.length === 7) {
      keyboard.push(row);
      row = [];
    }
  }

  if (row.length > 0) {
    while (row.length < 7) {
      row.push({ text: " ", callback_data: "noop" });
    }

    keyboard.push(row);
  }

  const now = new Date();
  const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const displayedMonth = new Date(year, month, 1);
  const navRow: any[] = [];

  const isCurrentMonth =
    displayedMonth.getFullYear() === currentMonth.getFullYear() &&
    displayedMonth.getMonth() === currentMonth.getMonth();
  const isNextMonth =
    displayedMonth.getFullYear() === nextMonth.getFullYear() &&
    displayedMonth.getMonth() === nextMonth.getMonth();

  if (isCurrentMonth) {
    navRow.push({
      text: "➡️ Следующий месяц",
      callback_data: `month_next_${year}_${month}_${mode}_${serviceId ?? "none"}`,
    });
  }

  if (isNextMonth) {
    navRow.push({
      text: "⬅️ Текущий месяц",
      callback_data: `month_prev_${year}_${month}_${mode}_${serviceId ?? "none"}`,
    });
  }

  if (navRow.length > 0) {
    keyboard.push(navRow);
  }

  return keyboard;
}
