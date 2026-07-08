import { toNumber } from "./nutrition";

export function getDateKey(date) {
  const target = new Date(date);
  const year = target.getFullYear();
  const month = String(target.getMonth() + 1).padStart(2, "0");
  const day = String(target.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function formatChartDateLabel(date, selectedDate) {
  if (isSameDate(date, selectedDate)) return "오늘";

  const month = date.getMonth() + 1;
  const day = date.getDate();

  return `${month}/${day}`;
}

export function formatTooltipDateLabel(date) {
  const month = date.getMonth() + 1;
  const day = date.getDate();

  return `${month}월 ${day}일`;
}

export function buildDatePoints(anchorDate, days = 7) {
  const points = [];

  for (let offset = -(days - 1); offset <= 0; offset += 1) {
    const date = addDays(anchorDate, offset);

    points.push({
      key: getDateKey(date),
      label: formatChartDateLabel(date, anchorDate),
      tooltipLabel: formatTooltipDateLabel(date),
    });
  }

  return points;
}

export function parseDateKey(key) {
  const [year, month, day] = String(key).split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

export function getLatestRecordDate(records, predicate) {
  return Object.entries(records)
    .filter(([, record]) => predicate(record))
    .map(([key]) => parseDateKey(key))
    .filter(Boolean)
    .sort((a, b) => a - b)
    .at(-1) || null;
}

export function getChartAnchorDate(records) {
  const today = new Date();
  const latestCompletedDate = getLatestRecordDate(records, (record) => Boolean(record?.dayComplete));
  const latestWeightDate = getLatestRecordDate(records, (record) => toNumber(record?.morningWeight) > 0);

  return [today, latestCompletedDate, latestWeightDate]
    .filter(Boolean)
    .sort((a, b) => a - b)
    .at(-1);
}

export function addDays(date, amount) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + amount);
  return nextDate;
}

export function isSameDate(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
