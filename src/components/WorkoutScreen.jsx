import { useEffect, useMemo, useState } from "react";

const PURPOSES = {
  strength: { label: "스트렝스", range: "3~6회", min: 3, max: 6 },
  hypertrophy: { label: "근비대", range: "8~15회", min: 8, max: 15 },
  endurance: { label: "근지구력", range: "16~25회", min: 16, max: 25 },
};

function normalizeLine(value) {
  return String(value || "").replace(/[×＊*']/g, "x").replace(/\s+/g, " ").trim();
}

function parseSetText(text) {
  const line = normalizeLine(text);
  const match = line.match(/^(?:(\d+(?:\.\d+)?)\s*(?:kg)?\s*x\s*)?(\d+)\s*(?:회)?(?:\s*x\s*(\d+)\s*(?:세트)?)?$/i);
  if (!match) return null;
  return {
    weight: match[1] ? Number(match[1]) : 0,
    reps: Number(match[2]),
    sets: match[3] ? Number(match[3]) : 1,
    raw: text.trim(),
  };
}

function parseInlineExercise(line) {
  const match = normalizeLine(line).match(/^(.+?)\s+(?:(\d+(?:\.\d+)?)\s*(?:kg)?\s*x\s*)?(\d+)\s*(?:회)?(?:\s*x\s*(\d+)\s*(?:세트)?)?$/i);
  if (!match || !/[가-힣a-zA-Z]/.test(match[1])) return null;
  return {
    name: match[1].trim(),
    set: {
      weight: match[2] ? Number(match[2]) : 0,
      reps: Number(match[3]),
      sets: match[4] ? Number(match[4]) : 1,
      raw: line.trim(),
    },
  };
}

export function parseWorkoutMemo(memo) {
  const exercises = [];
  let current = null;

  String(memo || "").split(/\r?\n/).forEach((sourceLine) => {
    const line = sourceLine.trim();
    if (!line) return;

    const set = parseSetText(line);
    if (set && current) {
      current.sets.push({ ...set, id: `${current.id}-set-${current.sets.length}` });
      return;
    }

    const inline = parseInlineExercise(line);
    if (inline) {
      current = {
        id: `exercise-${exercises.length}-${inline.name}`,
        name: inline.name,
        sets: [],
      };
      current.sets.push({ ...inline.set, id: `${current.id}-set-0` });
      exercises.push(current);
      return;
    }

    current = {
      id: `exercise-${exercises.length}-${line}`,
      name: line,
      sets: [],
    };
    exercises.push(current);
  });

  return exercises.filter((exercise) => exercise.sets.length > 0);
}

function inferPurpose(reps) {
  if (reps <= 6) return "strength";
  if (reps >= 16) return "endurance";
  return "hypertrophy";
}

function formatSet(set) {
  const weight = set.weight > 0 ? `${set.weight}kg × ` : "";
  return `${weight}${set.reps}회 × ${set.sets}세트`;
}

function getNextTarget(set, purposeKey, increment) {
  const purpose = PURPOSES[purposeKey] || PURPOSES.hypertrophy;
  if (set.reps < purpose.max) {
    return { ...set, reps: set.reps + 1 };
  }
  return {
    ...set,
    weight: set.weight > 0 ? set.weight + Number(increment || 0) : set.weight,
    reps: purpose.min,
  };
}

export default function WorkoutScreen({ workout, onChange }) {
  const [selecting, setSelecting] = useState(Boolean(workout?.selecting));

  useEffect(() => {
    setSelecting(Boolean(workout?.selecting));
  }, [workout?.selecting]);

  const parsed = useMemo(() => parseWorkoutMemo(workout?.memo), [workout?.memo]);
  const selections = workout?.selections || {};
  const increment = Number(workout?.increment || 5);

  const updateWorkout = (patch) => onChange({
    memo: "",
    completed: false,
    selecting: false,
    selections: {},
    targets: [],
    increment: 5,
    ...workout,
    ...patch,
  });

  const startSelection = () => {
    if (parsed.length === 0) return;
    setSelecting(true);
    updateWorkout({ selecting: true, completed: false });
  };

  const toggleExercise = (exercise) => {
    const existing = selections[exercise.id];
    const next = { ...selections };
    if (existing) {
      delete next[exercise.id];
    } else {
      next[exercise.id] = {
        name: exercise.name,
        selectedSetIds: exercise.sets.map((set) => set.id),
        purposes: Object.fromEntries(exercise.sets.map((set) => [set.id, inferPurpose(set.reps)])),
      };
    }
    updateWorkout({ selections: next });
  };

  const toggleSet = (exercise, set) => {
    const current = selections[exercise.id] || {
      name: exercise.name,
      selectedSetIds: [],
      purposes: {},
    };
    const selected = current.selectedSetIds.includes(set.id);
    const selectedSetIds = selected
      ? current.selectedSetIds.filter((id) => id !== set.id)
      : [...current.selectedSetIds, set.id];
    const next = { ...selections };
    if (selectedSetIds.length === 0) {
      delete next[exercise.id];
    } else {
      next[exercise.id] = {
        ...current,
        selectedSetIds,
        purposes: {
          ...current.purposes,
          [set.id]: current.purposes[set.id] || inferPurpose(set.reps),
        },
      };
    }
    updateWorkout({ selections: next });
  };

  const changePurpose = (exerciseId, setId, purpose) => {
    const current = selections[exerciseId];
    if (!current) return;
    updateWorkout({
      selections: {
        ...selections,
        [exerciseId]: {
          ...current,
          purposes: { ...current.purposes, [setId]: purpose },
        },
      },
    });
  };

  const saveWorkout = () => {
    const targets = [];
    parsed.forEach((exercise) => {
      const selected = selections[exercise.id];
      if (!selected) return;
      exercise.sets.forEach((set) => {
        if (!selected.selectedSetIds.includes(set.id)) return;
        const purpose = selected.purposes[set.id] || inferPurpose(set.reps);
        targets.push({
          exerciseName: exercise.name,
          source: set,
          purpose,
          next: getNextTarget(set, purpose, increment),
        });
      });
    });
    updateWorkout({ completed: true, selecting: false, targets });
    setSelecting(false);
  };

  const selectedSetCount = Object.values(selections).reduce((sum, item) => {
    const exercise = parsed.find((entry) => entry.id in selections && entry.name === item.name);
    if (!exercise) return sum;
    return sum + exercise.sets
      .filter((set) => item.selectedSetIds.includes(set.id))
      .reduce((setSum, set) => setSum + set.sets, 0);
  }, 0);

  return (
    <div className="workout-screen">
      <section className="workout-memo-card">
        <div className="section-title workout-title-row">
          <strong>운동 메모</strong>
          {workout?.completed && <span className="workout-saved-badge">저장됨</span>}
        </div>

        {!selecting ? (
          <textarea
            className="workout-memo-input"
            value={workout?.memo || ""}
            onChange={(event) => updateWorkout({ memo: event.target.value, completed: false, targets: [] })}
            placeholder={"스쿼트\n140 x 5 x 1\n160 x 5 x 3\n\n인클라인 덤벨프레스\n35 x 10 x 3"}
            spellCheck={false}
          />
        ) : (
          <div className="workout-selection-list">
            <p className="workout-selection-guide">점진적 과부하를 적용할 운동과 세트만 선택하세요.</p>
            {parsed.map((exercise) => {
              const exerciseSelection = selections[exercise.id];
              return (
                <article className="workout-exercise-block" key={exercise.id}>
                  <label className="workout-exercise-head">
                    <input
                      type="checkbox"
                      checked={Boolean(exerciseSelection)}
                      onChange={() => toggleExercise(exercise)}
                    />
                    <strong>{exercise.name}</strong>
                  </label>

                  {exercise.sets.map((set) => {
                    const checked = Boolean(exerciseSelection?.selectedSetIds.includes(set.id));
                    const purposeKey = exerciseSelection?.purposes?.[set.id] || inferPurpose(set.reps);
                    return (
                      <div className={`workout-set-row${checked ? " is-selected" : ""}`} key={set.id}>
                        <label>
                          <input type="checkbox" checked={checked} onChange={() => toggleSet(exercise, set)} />
                          <span>{formatSet(set)}</span>
                        </label>
                        {checked && (
                          <select value={purposeKey} onChange={(event) => changePurpose(exercise.id, set.id, event.target.value)}>
                            {Object.entries(PURPOSES).map(([key, purpose]) => (
                              <option key={key} value={key}>{purpose.label} ({purpose.range})</option>
                            ))}
                          </select>
                        )}
                      </div>
                    );
                  })}
                </article>
              );
            })}
          </div>
        )}

        <div className="workout-increment-row">
          <span>중량 증가 단위</span>
          <label><input type="number" min="0" step="0.5" value={increment} onChange={(event) => updateWorkout({ increment: event.target.value })} /> kg</label>
        </div>

        <div className="daily-memo-actions">
          <button className="ghost-button" type="button" onClick={() => updateWorkout({ memo: "", selections: {}, targets: [], completed: false })} disabled={!workout?.memo}>비우기</button>
          {!selecting ? (
            <button className="primary-button" type="button" onClick={startSelection} disabled={parsed.length === 0}>오늘 운동 완료</button>
          ) : (
            <button className="primary-button" type="button" onClick={saveWorkout} disabled={selectedSetCount === 0}>오늘 기록 저장</button>
          )}
        </div>
      </section>

      {selecting && (
        <div className="workout-selected-summary">선택한 성장 관리 세트 <strong>{selectedSetCount}세트</strong></div>
      )}

      {workout?.targets?.length > 0 && (
        <section className="workout-target-card">
          <div className="section-title"><strong>다음 운동 목표</strong></div>
          {workout.targets.map((target, index) => (
            <div className="workout-target-row" key={`${target.exerciseName}-${index}`}>
              <div>
                <strong>{target.exerciseName}</strong>
                <span>{formatSet(target.source)} → {formatSet(target.next)}</span>
              </div>
              <em>{PURPOSES[target.purpose]?.label}</em>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
