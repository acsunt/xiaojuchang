import type { Play } from '../../types/play';

export type PlayDayBucket = {
  dayKey: string;
  monthKey: string;
  count: number;
  plays: Play[];
};

export type CalendarCell = {
  dayKey: string;
  monthKey: string;
  dayNumber: number;
  count: number;
  plays: Play[];
  isCurrentMonth: boolean;
  isToday: boolean;
};

const pad = (value: number) => String(value).padStart(2, '0');

const toDateKey = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const getValidDate = (value: string | Date) => {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const comparePlayByCreatedAtDesc = (left: Play, right: Play) =>
  right.createdAt.localeCompare(left.createdAt) ||
  right.updatedAt.localeCompare(left.updatedAt) ||
  right.id.localeCompare(left.id);

export const getCurrentMonthKey = () => toMonthKey(new Date());

export const toDayKey = (value: string | Date) => {
  const date = getValidDate(value);
  return date ? toDateKey(date) : '';
};

export const toMonthKey = (value: string | Date) => {
  const date = getValidDate(value);
  return date ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}` : '';
};

export const getMonthKeyFromDayKey = (dayKey: string) => dayKey.slice(0, 7);

export const formatMonthLabel = (monthKey: string) => {
  const [yearText, monthText] = monthKey.split('-');
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const date = new Date(year, monthIndex, 1);

  if (Number.isNaN(date.getTime())) {
    return monthKey;
  }

  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
  }).format(date);
};

export const formatDayLabel = (dayKey: string) => {
  const [yearText, monthText, dayText] = dayKey.split('-');
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const day = Number(dayText);
  const date = new Date(year, monthIndex, day);

  if (Number.isNaN(date.getTime())) {
    return dayKey;
  }

  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(date);
};

export const buildPlayDayBuckets = (plays: Play[]): PlayDayBucket[] => {
  const grouped = new Map<string, Play[]>();

  plays.forEach((play) => {
    const dayKey = toDayKey(play.createdAt);
    if (!dayKey) {
      return;
    }

    const current = grouped.get(dayKey) ?? [];
    current.push(play);
    grouped.set(dayKey, current);
  });

  return [...grouped.entries()]
    .map(([dayKey, dayPlays]) => ({
      dayKey,
      monthKey: getMonthKeyFromDayKey(dayKey),
      count: dayPlays.length,
      plays: [...dayPlays].sort(comparePlayByCreatedAtDesc),
    }))
    .sort((left, right) => right.dayKey.localeCompare(left.dayKey));
};

export const buildCalendarCells = (
  monthKey: string,
  dayBuckets: Map<string, PlayDayBucket>,
): CalendarCell[] => {
  const [yearText, monthText] = monthKey.split('-');
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const firstDay = new Date(year, monthIndex, 1);

  if (Number.isNaN(firstDay.getTime())) {
    return [];
  }

  const gridStart = new Date(year, monthIndex, 1 - firstDay.getDay());
  const todayKey = toDayKey(new Date());

  return Array.from({ length: 42 }, (_, index) => {
    const currentDate = new Date(gridStart);
    currentDate.setDate(gridStart.getDate() + index);
    const dayKey = toDateKey(currentDate);
    const bucket = dayBuckets.get(dayKey);

    return {
      dayKey,
      monthKey: toMonthKey(currentDate),
      dayNumber: currentDate.getDate(),
      count: bucket?.count ?? 0,
      plays: bucket?.plays ?? [],
      isCurrentMonth: currentDate.getMonth() === monthIndex,
      isToday: dayKey === todayKey,
    };
  });
};
