export function MacroLegend({ label, value, percent, tone }) {
  return (
    <div className="macro-legend">
      <i className={"legend-dot " + tone} />
      <span>{label}</span>
      <strong>{value}g</strong>
      <small>{percent}%</small>
    </div>
  );
}
