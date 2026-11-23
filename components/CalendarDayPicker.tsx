"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  ALL_CALENDAR_DAYS,
  DAYS_IN_MONTH,
  MONTH_NAMES,
  calendarDayIndex,
  calendarDayKey,
  formatCalendarDay,
  isSameCalendarDay,
  nextCalendarDay,
  previousCalendarDay,
  type CalendarDay,
} from "@/lib/calendar-day";

export type CalendarDayPickerProps = {
  open: boolean;
  selectedDay: CalendarDay;
  readersToday: CalendarDay | null;
  onSelectDay: (day: CalendarDay) => void;
  onClose: () => void;
};

const stepCalendarDay = (day: CalendarDay, delta: number): CalendarDay => {
  const index = calendarDayIndex(day);
  const length = ALL_CALENDAR_DAYS.length;
  return ALL_CALENDAR_DAYS[(((index + delta) % length) + length) % length];
};

const shiftMonth = (day: CalendarDay, monthDelta: number): CalendarDay => {
  const nextMonth = (((day.month - 1 + monthDelta) % 12) + 12) % 12 + 1;
  const maxDay = DAYS_IN_MONTH[nextMonth - 1];
  return {
    month: nextMonth,
    day: Math.min(day.day, maxDay),
  };
};

const CalendarDayPickerDialog = ({
  selectedDay,
  readersToday,
  onSelectDay,
  onClose,
}: Omit<CalendarDayPickerProps, "open">) => {
  const [focusedDay, setFocusedDay] = useState<CalendarDay>(selectedDay);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const dayButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const shouldFocusGridDayRef = useRef(true);
  const titleId = useId();
  const monthHeadingId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousOverflow = document.body.style.overflow;
    if (!dialog.open) {
      if (typeof dialog.showModal === "function") {
        dialog.showModal();
      } else {
        dialog.setAttribute("open", "");
      }
    }
    document.body.style.overflow = "hidden";

    const initialKey = calendarDayKey(selectedDay);
    dayButtonRefs.current.get(initialKey)?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      if (dialog.open) {
        if (typeof dialog.close === "function") {
          dialog.close();
        } else {
          dialog.removeAttribute("open");
        }
      }
    };
  }, [selectedDay]);

  useEffect(() => {
    if (!shouldFocusGridDayRef.current) return;
    const button = dayButtonRefs.current.get(calendarDayKey(focusedDay));
    if (button && document.activeElement !== button) {
      button.focus();
    }
  }, [focusedDay]);

  const month = focusedDay.month;
  const monthName = MONTH_NAMES[month - 1];
  const prevMonthName = MONTH_NAMES[(month - 2 + 12) % 12];
  const nextMonthName = MONTH_NAMES[month % 12];
  const daysInMonth = DAYS_IN_MONTH[month - 1];

  const rows = useMemo(() => {
    const dayCells: CalendarDay[] = Array.from(
      { length: daysInMonth },
      (_, index) => ({ month, day: index + 1 }),
    );
    const grouped: CalendarDay[][] = [];
    for (let start = 0; start < dayCells.length; start += 7) {
      grouped.push(dayCells.slice(start, start + 7));
    }
    return grouped;
  }, [daysInMonth, month]);

  const moveFocusInGrid = (nextDay: CalendarDay) => {
    shouldFocusGridDayRef.current = true;
    setFocusedDay(nextDay);
  };

  const changeVisibleMonth = (monthDelta: number) => {
    shouldFocusGridDayRef.current = false;
    setFocusedDay((current) => shiftMonth(current, monthDelta));
  };

  const handleGridKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    cellDay: CalendarDay,
  ) => {
    let target: CalendarDay | null = null;
    if (event.key === "ArrowRight") {
      target = nextCalendarDay(cellDay);
    } else if (event.key === "ArrowLeft") {
      target = previousCalendarDay(cellDay);
    } else if (event.key === "ArrowDown") {
      target = stepCalendarDay(cellDay, 7);
    } else if (event.key === "ArrowUp") {
      target = stepCalendarDay(cellDay, -7);
    } else if (event.key === "Home") {
      target = { month: cellDay.month, day: 1 };
    } else if (event.key === "End") {
      target = { month: cellDay.month, day: DAYS_IN_MONTH[cellDay.month - 1] };
    } else if (event.key === "PageDown") {
      target = shiftMonth(cellDay, 1);
    } else if (event.key === "PageUp") {
      target = shiftMonth(cellDay, -1);
    } else {
      return;
    }

    event.preventDefault();
    moveFocusInGrid(target);
  };

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-modal="true"
      className="calendar-day-picker-dialog"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={handleDialogKeyDown}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="calendar-day-picker-panel">
        <div className="calendar-day-picker-top">
          <h2 id={titleId} className="calendar-day-picker-title">
            Choose a day
          </h2>
          <button
            type="button"
            className="btn-secondary calendar-day-picker-close"
            aria-label="Close calendar"
            onClick={onClose}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>

        <div className="calendar-day-picker-month-bar">
          <button
            type="button"
            className="btn-secondary calendar-day-picker-month-btn"
            aria-label={`Previous month, ${prevMonthName}`}
            onClick={() => changeVisibleMonth(-1)}
          >
            <span aria-hidden="true">‹</span>
          </button>
          <p
            id={monthHeadingId}
            className="calendar-day-picker-month-label"
            aria-live="polite"
            aria-atomic="true"
          >
            {monthName}
          </p>
          <button
            type="button"
            className="btn-secondary calendar-day-picker-month-btn"
            aria-label={`Next month, ${nextMonthName}`}
            onClick={() => changeVisibleMonth(1)}
          >
            <span aria-hidden="true">›</span>
          </button>
        </div>

        <div
          role="grid"
          aria-labelledby={monthHeadingId}
          className="calendar-day-picker-grid"
        >
          {rows.map((row, rowIndex) => (
            <div
              key={`${month}-row-${rowIndex}`}
              role="row"
              className="calendar-day-picker-row"
            >
              {row.map((cellDay) => {
                const key = calendarDayKey(cellDay);
                const isSelected = isSameCalendarDay(cellDay, selectedDay);
                const isFocused = isSameCalendarDay(cellDay, focusedDay);
                const isToday =
                  readersToday !== null &&
                  isSameCalendarDay(cellDay, readersToday);
                return (
                  <div
                    key={key}
                    role="gridcell"
                    aria-selected={isSelected ? "true" : undefined}
                    className="calendar-day-picker-cell"
                  >
                    <button
                      ref={(node) => {
                        if (node) {
                          dayButtonRefs.current.set(key, node);
                        } else {
                          dayButtonRefs.current.delete(key);
                        }
                      }}
                      type="button"
                      tabIndex={isFocused ? 0 : -1}
                      aria-label={formatCalendarDay(cellDay)}
                      aria-current={isToday ? "date" : undefined}
                      className={[
                        "calendar-day-picker-day",
                        isSelected ? "is-selected" : "",
                        isToday ? "is-today" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      onClick={() => onSelectDay(cellDay)}
                      onKeyDown={(event) => handleGridKeyDown(event, cellDay)}
                    >
                      {cellDay.day}
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        <div className="calendar-day-picker-footer">
          {readersToday ? (
            <button
              type="button"
              className="btn-secondary calendar-day-picker-today"
              onClick={() => onSelectDay(readersToday)}
            >
              Today ({formatCalendarDay(readersToday)})
            </button>
          ) : null}
          <button
            type="button"
            className="btn-secondary calendar-day-picker-cancel"
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      </div>
    </dialog>
  );
};

export const CalendarDayPicker = ({
  open,
  selectedDay,
  readersToday,
  onSelectDay,
  onClose,
}: CalendarDayPickerProps) => {
  if (!open) return null;
  return (
    <CalendarDayPickerDialog
      selectedDay={selectedDay}
      readersToday={readersToday}
      onSelectDay={onSelectDay}
      onClose={onClose}
    />
  );
};
