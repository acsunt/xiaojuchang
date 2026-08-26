import { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_CATEGORY, type Play } from '../../types/play';
import {
  buildCalendarCells,
  buildPlayDayBuckets,
  formatDayLabel,
  getCurrentMonthKey,
} from './plaza-calendar';

type PlazaCalendarPanelProps = {
  plays: Play[];
  onOpenPlay: (play: Play) => void;
};

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

const formatTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

const formatMonthNumberLabel = (monthKey: string) => {
  const month = Number(monthKey.slice(5, 7));
  return Number.isFinite(month) ? `${month}月` : monthKey;
};

export function PlazaCalendarPanel({ plays, onOpenPlay }: PlazaCalendarPanelProps) {
  const pickerAreaRef = useRef<HTMLDivElement | null>(null);
  const dayBuckets = useMemo(() => buildPlayDayBuckets(plays), [plays]);
  const dayBucketMap = useMemo(
    () => new Map(dayBuckets.map((item) => [item.dayKey, item])),
    [dayBuckets],
  );
  const availableMonthKeys = useMemo(
    () =>
      [...new Set(dayBuckets.map((item) => item.monthKey))].sort((left, right) =>
        left.localeCompare(right),
      ),
    [dayBuckets],
  );
  const latestDayKey = dayBuckets[0]?.dayKey ?? '';
  const latestMonthKey = availableMonthKeys[availableMonthKeys.length - 1] ?? getCurrentMonthKey();
  const [activeMonthKey, setActiveMonthKey] = useState(() => latestMonthKey);
  const [selectedDayKey, setSelectedDayKey] = useState(() => latestDayKey);
  const [yearPickerOpen, setYearPickerOpen] = useState(false);
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);

  useEffect(() => {
    if (dayBuckets.length === 0) {
      setActiveMonthKey(getCurrentMonthKey());
      setSelectedDayKey('');
      return;
    }

    setActiveMonthKey((current) =>
      availableMonthKeys.includes(current) ? current : latestMonthKey,
    );
    setSelectedDayKey((current) => current || latestDayKey);
  }, [availableMonthKeys, dayBuckets.length, latestDayKey, latestMonthKey]);

  useEffect(() => {
    if (!yearPickerOpen && !monthPickerOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!pickerAreaRef.current?.contains(event.target as Node)) {
        setYearPickerOpen(false);
        setMonthPickerOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setYearPickerOpen(false);
        setMonthPickerOpen(false);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleEscape);

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [monthPickerOpen, yearPickerOpen]);

  const calendarCells = useMemo(
    () => buildCalendarCells(activeMonthKey, dayBucketMap),
    [activeMonthKey, dayBucketMap],
  );
  const selectedDayBucket = dayBucketMap.get(selectedDayKey);
  const selectedDayLabel = selectedDayKey ? formatDayLabel(selectedDayKey) : '';
  const activeYear = activeMonthKey.slice(0, 4);
  const activeMonthNumber = activeMonthKey.slice(5, 7);
  const availableYears = useMemo(
    () => [...new Set(availableMonthKeys.map((item) => item.slice(0, 4)))],
    [availableMonthKeys],
  );
  const availableMonthsOfYear = useMemo(
    () => availableMonthKeys.filter((item) => item.startsWith(`${activeYear}-`)),
    [activeYear, availableMonthKeys],
  );

  const openMonth = (monthKey: string) => {
    if (!monthKey) {
      return;
    }

    setActiveMonthKey(monthKey);
    const firstPlayableDay = dayBuckets.find((item) => item.monthKey === monthKey)?.dayKey;
    setSelectedDayKey(firstPlayableDay ?? '');
  };

  const selectYear = (year: string) => {
    const candidateMonths = availableMonthKeys.filter((item) => item.startsWith(`${year}-`));
    const targetMonth =
      candidateMonths.find((item) => item.slice(5, 7) === activeMonthNumber) ??
      candidateMonths[candidateMonths.length - 1];
    if (targetMonth) {
      openMonth(targetMonth);
    }
    setYearPickerOpen(false);
  };

  const selectMonth = (monthKey: string) => {
    openMonth(monthKey);
    setMonthPickerOpen(false);
  };

  return (
    <section className="form-panel plaza-calendar-panel">
      <div className="sidebar-head plaza-calendar-head">
        <h3>新增日历</h3>
      </div>
      <p className="sub-copy plaza-calendar-intro">
        按当前筛选范围统计每天新增的小剧场，点日期即可查看当天列表。
      </p>

      <div className="plaza-calendar-picker-bar" ref={pickerAreaRef}>
        <div className={yearPickerOpen ? 'plaza-calendar-picker open' : 'plaza-calendar-picker'}>
          <button
            aria-expanded={yearPickerOpen}
            className="text-button plaza-calendar-picker-trigger"
            onClick={() => {
              setYearPickerOpen((current) => !current);
              setMonthPickerOpen(false);
            }}
            type="button"
          >
            {activeYear} 年
          </button>
          {yearPickerOpen ? (
            <div className="plaza-calendar-picker-menu" role="listbox" aria-label="选择年份">
              {availableYears.map((year) => (
                <button
                  aria-selected={year === activeYear}
                  className={
                    year === activeYear
                      ? 'plaza-calendar-picker-option active'
                      : 'plaza-calendar-picker-option'
                  }
                  key={year}
                  onClick={() => selectYear(year)}
                  role="option"
                  type="button"
                >
                  {year} 年
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className={monthPickerOpen ? 'plaza-calendar-picker open' : 'plaza-calendar-picker'}>
          <button
            aria-expanded={monthPickerOpen}
            className="text-button plaza-calendar-picker-trigger"
            onClick={() => {
              setMonthPickerOpen((current) => !current);
              setYearPickerOpen(false);
            }}
            type="button"
          >
            {Number(activeMonthNumber)} 月
          </button>
          {monthPickerOpen ? (
            <div
              className="plaza-calendar-picker-menu plaza-calendar-picker-menu-months"
              role="listbox"
              aria-label="选择月份"
            >
              {availableMonthsOfYear.map((monthKey) => (
                <button
                  aria-selected={monthKey === activeMonthKey}
                  className={
                    monthKey === activeMonthKey
                      ? 'plaza-calendar-picker-option active'
                      : 'plaza-calendar-picker-option'
                  }
                  key={monthKey}
                  onClick={() => selectMonth(monthKey)}
                  role="option"
                  type="button"
                >
                  {formatMonthNumberLabel(monthKey)}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="plaza-calendar-weekdays" aria-hidden="true">
        {WEEKDAY_LABELS.map((label) => (
          <span className="plaza-calendar-weekday" key={label}>
            {label}
          </span>
        ))}
      </div>

      <div className="plaza-calendar-grid">
        {calendarCells.map((cell) => {
          const selected = cell.dayKey === selectedDayKey;
          const buttonClassName = [
            'plaza-calendar-day',
            cell.isCurrentMonth ? '' : 'outside-month',
            cell.count > 0 ? 'has-plays' : '',
            cell.isToday ? 'today' : '',
            selected ? 'active' : '',
          ]
            .filter(Boolean)
            .join(' ');

          return (
            <button
              aria-pressed={selected}
              className={buttonClassName}
              key={cell.dayKey}
              onClick={() => {
                setSelectedDayKey(cell.dayKey);
                if (cell.monthKey !== activeMonthKey) {
                  setActiveMonthKey(cell.monthKey);
                }
              }}
              type="button"
            >
              <span className="plaza-calendar-day-number">{cell.dayNumber}</span>
              <span className="plaza-calendar-day-count">
                {cell.count > 0 ? `${cell.count} 篇` : '—'}
              </span>
            </button>
          );
        })}
      </div>

      <div className="plaza-calendar-detail stack-gap-sm">
        <div className="sidebar-head plaza-calendar-detail-head">
          <div className="stack-gap-sm">
            <strong>{selectedDayLabel || '暂无日期'}</strong>
            <span className="content-meta">
              {selectedDayBucket ? `当天发布 ${selectedDayBucket.count} 篇` : '当天没有新增小剧场'}
            </span>
          </div>
        </div>

        {selectedDayBucket?.plays.length ? (
          <div className="plaza-calendar-play-list">
            {selectedDayBucket.plays.map((play) => (
              <button
                className="plaza-calendar-play-item"
                key={play.id}
                onClick={() => onOpenPlay(play)}
                type="button"
              >
                <strong>{play.title}</strong>
                <div className="compact-meta-row compact-meta-row-small">
                  <span>{play.authorName || '匿名'}</span>
                  <span>{play.category?.trim() || DEFAULT_CATEGORY}</span>
                  <span>{formatTime(play.createdAt)}</span>
                </div>
                {play.summary ? (
                  <span className="sub-copy plaza-calendar-play-summary">{play.summary}</span>
                ) : null}
              </button>
            ))}
          </div>
        ) : (
          <div className="plaza-calendar-empty">
            <span className="content-meta">换一天看看，或者调整右侧筛选条件。</span>
          </div>
        )}
      </div>
    </section>
  );
}
