export const DEFAULT_WORKDAY_START_MINUTES = 10 * 60;
export const DEFAULT_WORKDAY_END_MINUTES = 18 * 60;
export const SLOT_INTERVAL_MINUTES = 30;
export const CONFIRMATION_REMINDER_OFFSET_MS = 24 * 60 * 60 * 1000;
export const CONFIRMATION_TIMEOUT_MS = 2 * 60 * 60 * 1000;

export const formatDuration = (durationMinutes: number) => {
  if (durationMinutes % 60 === 0) {
    return `${durationMinutes / 60} ч.`;
  }

  if (durationMinutes > 60) {
    const hours = Math.floor(durationMinutes / 60);
    const minutes = durationMinutes % 60;

    return `${hours} ч. ${minutes} мин.`;
  }

  return `${durationMinutes} мин.`;
};

export const parseTimeToMinutes = (time: string) => {
  const [hoursText, minutesText] = time.split(":");
  return Number(hoursText) * 60 + Number(minutesText);
};

export const formatMinutesToTime = (minutes: number) => {
  const hours = Math.floor(minutes / 60)
    .toString()
    .padStart(2, "0");
  const mins = (minutes % 60).toString().padStart(2, "0");

  return `${hours}:${mins}`;
};

export const formatLocalDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");

  return `${year}-${month}-${day}`;
};

export const getDateFromDateAndTime = (date: string, time: string) => {
  const [yearText, monthText, dayText] = date.split("-");
  const [hoursText, minutesText] = time.split(":");

  return new Date(
    Number(yearText),
    Number(monthText) - 1,
    Number(dayText),
    Number(hoursText),
    Number(minutesText),
    0,
    0,
  );
};

export const getTodayDateKey = () => formatLocalDateKey(new Date());

export const getCurrentMinutes = () => {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
};

export const isTimeRangeOverlapping = (
  startA: number,
  endA: number,
  startB: number,
  endB: number,
) => startA < endB && startB < endA;
