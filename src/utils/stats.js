import { buildDatePoints, getChartAnchorDate, getDateKey } from "./date";
import { calculateTotals, toNumber } from "./nutrition";
import { parseTimeInput } from "./foodParser";

export function buildHourlyCaloriePoints(meals = []) {
  let cumulativeKcal = 0;

  return (meals || [])
    .map((meal, index) => {
      const time = parseTimeInput(meal.time);
      if (!time) return null;

      const [hour, minute] = time.split(":").map(Number);
      const minutes = hour * 60 + minute;
      const mealKcal = calculateTotals([meal]).kcal;
      if (mealKcal <= 0) return null;

      return {
        key: "24h-meal-" + index + "-" + time,
        label: time,
        tooltipLabel: time,
        minutes,
        xPercent: Math.min(100, Math.max(0, (minutes / 1440) * 100)),
        mealKcal,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.minutes - b.minutes)
    .map((point) => {
      cumulativeKcal += point.mealKcal;
      return {
        ...point,
        kcal: Math.round(cumulativeKcal),
      };
    });
}

export function buildStats(meals, plan, morningWeight, dailyRecords, selectedDate) {
  const totals = calculateTotals(meals);
  const selectedKey = getDateKey(selectedDate);
  const selectedRecord = dailyRecords[selectedKey] || {};
  const records = {
    ...dailyRecords,
    [selectedKey]: {
      ...selectedRecord,
      kcal: Math.round(totals.kcal),
      carb: totals.carb,
      protein: totals.protein,
      fat: totals.fat,
      morningWeight: toNumber(morningWeight) || selectedRecord.morningWeight || 0,
    },
  };
  const macroTotal = totals.carb + totals.protein + totals.fat;

  const chartAnchorDate = getChartAnchorDate(records);

  const makeWeightTrend = (range) => {
    const days = range === "30" ? 30 : 7;
    return buildDatePoints(chartAnchorDate, days)
      .map((point) => ({ ...point, weight: toNumber(records[point.key]?.morningWeight) }))
      .filter((point) => point.weight > 0);
  };

  const makeCalorieTrend = (range) => {
    if (range === "24") return buildHourlyCaloriePoints(meals);

    const days = range === "30" ? 30 : 7;
    return buildDatePoints(chartAnchorDate, days)
      .map((point) => {
        const record = records[point.key] || {};
        return {
          ...point,
          kcal: record.dayComplete ? toNumber(record.kcal) : 0,
        };
      })
      .filter((point) => point.kcal > 0);
  };

  return {
    totals,
    currentKcal: Math.round(totals.kcal),
    makeWeightTrend,
    makeCalorieTrend,
    macroRates: {
      carb: macroTotal > 0 ? Math.round((totals.carb / macroTotal) * 100) : 0,
      protein: macroTotal > 0 ? Math.round((totals.protein / macroTotal) * 100) : 0,
      fat: macroTotal > 0 ? Math.round((totals.fat / macroTotal) * 100) : 0,
    },
  };
}
