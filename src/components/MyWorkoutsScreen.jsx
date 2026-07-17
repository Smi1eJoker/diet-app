import { useMemo, useState } from "react";

const BODY_PARTS = ["가슴", "어깨", "등", "하체", "팔"];
const PURPOSE_LABELS = { strength: "스트렝스", hypertrophy: "근비대", endurance: "근지구력" };
const EQUIPMENT_LABELS = { barbell: "바벨", dumbbell: "덤벨", machine: "머신", cable: "케이블" };

function formatSource(set = {}) {
  const weight = set.weightText ?? set.weight;
  const reps = set.repsText ?? set.reps;
  return `${weight || 0}kg × ${reps || 0}회 × ${set.sets || 0}세트`;
}

export default function MyWorkoutsScreen({ dailyRecords = {} }) {
  const [activePart, setActivePart] = useState("가슴");
  const items = useMemo(() => {
    const map = new Map();
    Object.entries(dailyRecords).forEach(([date, record]) => {
      const workout = record?.workout;
      if (!workout?.completed) return;
      (workout.targets || []).forEach((target) => {
        const part = target.bodyPart || workout.bodyParts?.[0] || workout.bodyPart || "기타";
        const key = `${part}|${target.exerciseName}|${target.purpose}`;
        const current = map.get(key) || {
          part,
          name: target.exerciseName,
          purpose: target.purpose,
          equipment: target.equipment,
          totalSets: 0,
          latestDate: "",
          latestSet: null,
        };
        current.totalSets += Number(target.source?.sets || 0);
        if (!current.latestDate || date > current.latestDate) {
          current.latestDate = date;
          current.latestSet = target.source;
          current.equipment = target.equipment;
        }
        map.set(key, current);
      });
    });
    return [...map.values()].sort((a, b) => b.latestDate.localeCompare(a.latestDate));
  }, [dailyRecords]);

  const filtered = items.filter((item) => item.part === activePart);

  return (
    <section className="my-workouts-screen">
      <div className="section-title"><strong>나의 운동</strong></div>
      <p className="my-workouts-guide">저장한 성장 관리 세트를 부위와 훈련 목적별로 확인해.</p>
      <div className="my-workouts-tabs">
        {BODY_PARTS.map((part) => (
          <button key={part} className={activePart === part ? "is-active" : ""} type="button" onClick={() => setActivePart(part)}>{part}</button>
        ))}
      </div>
      <div className="my-workouts-list">
        {filtered.length === 0 ? (
          <div className="empty-state"><strong>저장된 운동이 없어.</strong><span>운동 기록에서 세트와 부위를 선택해 저장하면 여기에 쌓여.</span></div>
        ) : filtered.map((item) => (
          <article className="my-workout-card" key={`${item.part}-${item.name}-${item.purpose}`}>
            <div>
              <strong>{item.name}</strong>
              <span>{EQUIPMENT_LABELS[item.equipment] || "구분 없음"} · {PURPOSE_LABELS[item.purpose] || item.purpose}</span>
              <em>최근 {formatSource(item.latestSet)}</em>
            </div>
            <b>{item.totalSets}세트</b>
          </article>
        ))}
      </div>
    </section>
  );
}
