import { useEffect, useState } from "react";
import { formatMacro } from "../utils/nutrition";

export default function StatsScreen({ stats }) {
  const [calorieRange, setCalorieRange] = useState("24");
  const [weightRange, setWeightRange] = useState("7");
  const calorieTrend = stats.makeCalorieTrend(calorieRange);
  const weightTrend = stats.makeWeightTrend(weightRange);

  return (
    <section className="stats-screen" aria-label="통계">
      <div className="stats-card weight-chart-card">
        <div className="section-title chart-title-row">
          <strong>일 섭취 칼로리</strong>
          <ChartRangeToggle value={calorieRange} onChange={setCalorieRange} options={["24", "7", "30"]} />
        </div>
        <LineChart points={calorieTrend} valueKey="kcal" unit="kcal" emptyText="아직 칼로리 기록이 없어." />
      </div>

      <div className="stats-card weight-chart-card">
        <div className="section-title chart-title-row">
          <strong>체중 변화</strong>
          <ChartRangeToggle value={weightRange} onChange={setWeightRange} />
        </div>
        <LineChart points={weightTrend} valueKey="weight" unit="kg" emptyText="아직 체중 기록이 없어." />
      </div>
    </section>
  );
}

export function ChartRangeToggle({ value, onChange, options = ["7", "30"] }) {
  const labels = {
    "24": "24시간",
    "7": "최근 7일",
    "30": "최근 30일",
  };

  return (
    <div className={"chart-range-toggle" + (options.length >= 3 ? " has-three-options" : "")} role="group" aria-label="그래프 기간">
      {options.map((option) => (
        <button
          key={option}
          className={value === option ? "is-selected" : ""}
          type="button"
          onClick={() => onChange(option)}
        >
          {labels[option] || option}
        </button>
      ))}
    </div>
  );
}

export function LineChart({ points, valueKey, unit, emptyText }) {
  const [selectedIndex, setSelectedIndex] = useState(null);
  const pointKeys = points.map((point) => point.key).join("|");

  useEffect(() => {
    setSelectedIndex(null);
  }, [pointKeys, valueKey, unit]);

  if (points.length === 0) {
    return <div className="chart-empty-state">{emptyText}</div>;
  }

  const values = points.map((point) => point[valueKey]).filter((value) => value > 0);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;
  const range = Math.max(0.1, max - min);

  const getPointPosition = (point, index) => {
    const hasCustomX = Number.isFinite(Number(point.xPercent));
    const x = hasCustomX
      ? Math.min(95, Math.max(5, Number(point.xPercent)))
      : points.length === 1
        ? 50
        : (index / (points.length - 1)) * 100;
    const y = values.length === 1 ? 50 : 86 - ((point[valueKey] - min) / range) * 66;
    return { x, y };
  };

  const polyline = points
    .map((point, index) => {
      const { x, y } = getPointPosition(point, index);
      return x + "," + y;
    })
    .join(" ");

  const selectedPoint = selectedIndex === null ? null : points[selectedIndex];
  const selectedPosition = selectedPoint ? getPointPosition(selectedPoint, selectedIndex) : null;
  const selectedPlacement = selectedPosition
    ? selectedPosition.x < 18
      ? " is-left-edge"
      : selectedPosition.x > 82
        ? " is-right-edge"
        : ""
    : "";

  const shouldShowLabel = (index) => {
    if (points.length <= 8) return true;
    return index === 0 || index === points.length - 1 || index % 5 === 0;
  };

  return (
    <div className="weight-line-chart" onClick={() => setSelectedIndex(null)}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <polyline points={polyline} />
      </svg>
      <div className="weight-points">
        {points.map((point, index) => {
          const { x, y } = getPointPosition(point, index);
          const valueText = formatMacro(point[valueKey]) + unit;
          const dateText = point.tooltipLabel || point.label;
          return (
            <button
              key={point.key || point.label}
              className={selectedIndex === index ? "is-selected" : ""}
              type="button"
              style={{ left: x + "%", top: y + "%" }}
              aria-label={valueText + " / " + dateText}
              onClick={(event) => {
                event.stopPropagation();
                setSelectedIndex((current) => (current === index ? null : index));
              }}
            />
          );
        })}
      </div>
      <div className="weight-labels" style={{ gridTemplateColumns: "repeat(" + points.length + ", minmax(0, 1fr))" }}>
        {points.map((point, index) => (
          <span key={point.key || point.label}>{shouldShowLabel(index) ? point.label : ""}</span>
        ))}
      </div>
      {selectedPoint && selectedPosition && (
        <div
          className={"chart-point-tooltip" + selectedPlacement}
          style={{ left: selectedPosition.x + "%", top: selectedPosition.y + "%" }}
        >
          <strong>{formatMacro(selectedPoint[valueKey])}{unit}</strong>
          <span>{selectedPoint.tooltipLabel || selectedPoint.label}</span>
        </div>
      )}
    </div>
  );
}

export function StatsBar({ label, value, target, unit = "kcal" }) {
  const percent = target > 0 ? Math.round((value / target) * 100) : 0;
  const width = Math.min(100, percent);
  const isOver = value > target;
  return (
    <div className="stats-bar-row">
      <div>
        <span>{label}</span>
        <strong>{formatMacro(value)} / {target}{unit}</strong>
        <small>{percent}%</small>
      </div>
      <div className="stats-track">
        <i className={isOver ? "over" : "good"} style={{ width: width + "%" }} />
      </div>
    </div>
  );
}
