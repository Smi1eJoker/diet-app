import { useMemo, useRef, useState } from "react";
import useLongPress from "../hooks/useLongPress";
import { normalizeWorkoutLine, parseInlineWorkoutExercise, parseWorkoutMemo, parseWorkoutSetText } from "../utils/workout";

const PURPOSES = {
  strength: { label: "스트렝스", range: "3~6회", min: 3, max: 6 },
  hypertrophy: { label: "근비대", range: "8~15회", min: 8, max: 15 },
  endurance: { label: "근지구력", range: "16~25회", min: 16, max: 25 },
};

const EQUIPMENT_OPTIONS = [
  { value: "barbell", label: "바벨" },
  { value: "dumbbell", label: "덤벨" },
  { value: "machine", label: "머신" },
  { value: "cable", label: "케이블" },
];

const DEFAULT_WEIGHT_INCREMENT = 5;

function normalizeHistoryKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^0-9a-z가-힣]/g, "");
}

function uniqueHistoryItems(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = normalizeHistoryKey(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractMemoExerciseNames(memo) {
  return uniqueHistoryItems(
    String(memo || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && /[가-힣a-zA-Z]/.test(line) && !parseWorkoutSetText(line))
      .map((line) => parseInlineWorkoutExercise(line)?.name || line),
  );
}

function inferPurpose(reps) {
  if (reps <= 6) return "strength";
  if (reps >= 16) return "endurance";
  return "hypertrophy";
}

function formatSet(set) {
  const weightText = set.weightText ?? (set.weight !== 0 ? String(set.weight) : "");
  const repsText = set.repsText ?? String(set.reps);
  const weight = weightText ? `${weightText}kg × ` : "";
  return `${weight}${repsText}회 × ${set.sets}세트`;
}

function getNextTarget(set, purposeKey) {
  const purpose = PURPOSES[purposeKey] || PURPOSES.hypertrophy;
  if (set.reps < purpose.max) {
    return { ...set, reps: set.reps + 1 };
  }
  return {
    ...set,
    weight: set.weight !== 0 ? set.weight + DEFAULT_WEIGHT_INCREMENT : set.weight,
    weightText: undefined,
    repsText: undefined,
    reps: purpose.min,
  };
}

function findMatchingHistory(values, query, limit = 5) {
  const normalizedQuery = normalizeHistoryKey(query);
  if (!normalizedQuery) return [];

  return uniqueHistoryItems(values)
    .map((value, index) => {
      const key = normalizeHistoryKey(value);
      const startsWith = key.startsWith(normalizedQuery);
      const includes = key.includes(normalizedQuery);
      return { value, index, startsWith, includes };
    })
    .filter((item) => item.includes)
    .sort((a, b) => Number(b.startsWith) - Number(a.startsWith) || a.index - b.index)
    .slice(0, limit)
    .map((item) => item.value);
}

function getCurrentLineInfo(value, cursorPosition) {
  const safeValue = String(value || "");
  const cursor = Math.max(0, Math.min(Number(cursorPosition) || 0, safeValue.length));
  const lineStart = safeValue.lastIndexOf("\n", Math.max(0, cursor - 1)) + 1;
  const nextBreak = safeValue.indexOf("\n", cursor);
  const lineEnd = nextBreak === -1 ? safeValue.length : nextBreak;
  const rawLine = safeValue.slice(lineStart, lineEnd);
  return {
    lineStart,
    lineEnd,
    rawLine,
    query: rawLine.trim(),
  };
}

function buildCompletedMemoRows(memo, parsed, selections) {
  const rows = [];
  let sourceExerciseIndex = -1;
  let currentExercise = null;
  let setIndex = 0;

  String(memo || "").split(/\r?\n/).forEach((sourceLine, lineIndex) => {
    const line = sourceLine.trim();

    if (!line) {
      rows.push({ key: `blank-${lineIndex}`, text: "", selected: false });
      return;
    }

    const parsedSet = parseWorkoutSetText(line);
    if (parsedSet && currentExercise) {
      const set = currentExercise.sets[setIndex];
      const selected = Boolean(set && selections[currentExercise.id]?.selectedSetIds?.includes(set.id));
      rows.push({ key: `set-${lineIndex}`, text: sourceLine, selected });
      setIndex += 1;
      return;
    }

    const inline = parseInlineWorkoutExercise(line);
    sourceExerciseIndex += 1;
    const exerciseName = inline?.name || line;
    const exerciseId = `exercise-${sourceExerciseIndex}-${exerciseName}`;
    currentExercise = parsed.find((exercise) => exercise.id === exerciseId) || null;
    setIndex = inline ? 1 : 0;

    const exerciseSelected = Boolean(currentExercise && selections[currentExercise.id]);
    const inlineSetSelected = Boolean(
      inline
      && currentExercise?.sets?.[0]
      && selections[currentExercise.id]?.selectedSetIds?.includes(currentExercise.sets[0].id),
    );

    rows.push({
      key: `exercise-${lineIndex}`,
      text: sourceLine,
      selected: inline ? inlineSetSelected : exerciseSelected,
    });
  });

  return rows;
}

export default function WorkoutScreen({ workout, onChange, history = {} }) {
  const [bodyPartFocused, setBodyPartFocused] = useState(false);
  const [memoFocused, setMemoFocused] = useState(false);
  const [memoCursor, setMemoCursor] = useState(0);
  const memoRef = useRef(null);

  const parsed = useMemo(() => parseWorkoutMemo(workout?.memo), [workout?.memo]);
  const selecting = Boolean(workout?.selecting && parsed.length > 0);
  const selections = useMemo(() => workout?.selections || {}, [workout?.selections]);
  const equipmentByExercise = useMemo(
    () => workout?.equipmentByExercise || {},
    [workout?.equipmentByExercise],
  );
  const bodyPart = workout?.bodyPart || "";

  const updateWorkout = (patch) => {
    const nextWorkout = {
      memo: "",
      bodyPart: "",
      completed: false,
      selecting: false,
      selections: {},
      equipmentByExercise: {},
      targets: [],
      ...workout,
      ...patch,
    };
    delete nextWorkout.increment;
    onChange(nextWorkout);
  };

  const editCompletedWorkout = () => {
    updateWorkout({ completed: false, selecting: false, targets: [] });
    window.requestAnimationFrame(() => memoRef.current?.focus());
  };

  const completedLongPressProps = useLongPress(editCompletedWorkout);

  const bodyPartSuggestions = useMemo(
    () => (bodyPartFocused ? findMatchingHistory(history.bodyParts || [], bodyPart) : []),
    [bodyPartFocused, bodyPart, history.bodyParts],
  );

  const memoLineInfo = useMemo(
    () => getCurrentLineInfo(workout?.memo || "", memoCursor),
    [workout?.memo, memoCursor],
  );

  const exerciseSuggestionPool = useMemo(
    () => uniqueHistoryItems([...(history.exerciseNames || []), ...extractMemoExerciseNames(workout?.memo)]),
    [history.exerciseNames, workout?.memo],
  );

  const exerciseSuggestions = useMemo(() => {
    if (!memoFocused || selecting) return [];
    const query = memoLineInfo.query;
    if (!query || /\d/.test(query) || /(?:^|\s)x(?:\s|$)/i.test(query)) return [];
    return findMatchingHistory(exerciseSuggestionPool, query).filter(
      (name) => normalizeHistoryKey(name) !== normalizeHistoryKey(query),
    );
  }, [memoFocused, selecting, memoLineInfo.query, exerciseSuggestionPool]);

  const startSelection = () => {
    if (parsed.length === 0) return;
    updateWorkout({ bodyPart: bodyPart.trim(), selecting: true, completed: false });
  };

  const toggleExercise = (exercise) => {
    const existing = selections[exercise.id];
    const next = { ...selections };
    if (existing) {
      delete next[exercise.id];
    } else {
      next[exercise.id] = {
        name: exercise.name,
        equipment: equipmentByExercise[normalizeHistoryKey(exercise.name)] || history.equipmentByExercise?.[normalizeHistoryKey(exercise.name)] || "",
        selectedSetIds: [],
        purposes: {},
      };
    }
    updateWorkout({ selections: next });
  };

  const toggleSet = (exercise, set) => {
    const current = selections[exercise.id] || {
      name: exercise.name,
      equipment: equipmentByExercise[normalizeHistoryKey(exercise.name)] || history.equipmentByExercise?.[normalizeHistoryKey(exercise.name)] || "",
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

  const changeEquipment = (exercise, equipment) => {
    const exerciseKey = normalizeHistoryKey(exercise.name);
    const nextEquipmentByExercise = {
      ...equipmentByExercise,
      [exerciseKey]: equipment,
    };
    const currentSelection = selections[exercise.id];
    const nextSelections = currentSelection
      ? {
          ...selections,
          [exercise.id]: { ...currentSelection, equipment },
        }
      : selections;

    updateWorkout({
      equipmentByExercise: nextEquipmentByExercise,
      selections: nextSelections,
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
          equipment: equipmentByExercise[normalizeHistoryKey(exercise.name)] || selected.equipment || history.equipmentByExercise?.[normalizeHistoryKey(exercise.name)] || "",
          source: set,
          purpose,
          next: getNextTarget(set, purpose),
        });
      });
    });
    updateWorkout({ bodyPart: bodyPart.trim(), completed: true, selecting: false, targets });
  };

  const selectedSetCount = Object.values(selections).reduce((sum, item) => {
    const exercise = parsed.find((entry) => entry.id in selections && entry.name === item.name);
    if (!exercise) return sum;
    return sum + exercise.sets
      .filter((set) => item.selectedSetIds.includes(set.id))
      .reduce((setSum, set) => setSum + set.sets, 0);
  }, 0);

  const completedMemoRows = useMemo(
    () => buildCompletedMemoRows(workout?.memo, parsed, selections),
    [workout?.memo, parsed, selections],
  );

  const handleMemoChange = (event) => {
    setMemoCursor(event.target.selectionStart || 0);
    updateWorkout({
      memo: event.target.value,
      selecting: false,
      completed: false,
      selections: {},
      targets: [],
    });
  };

  const handleMemoSelection = (event) => {
    setMemoCursor(event.currentTarget.selectionStart || 0);
  };

  const handleMemoKeyDown = (event) => {
    if (event.key !== " " || event.nativeEvent?.isComposing) return;

    const input = event.currentTarget;
    const selectionStart = input.selectionStart ?? 0;
    const selectionEnd = input.selectionEnd ?? selectionStart;
    if (selectionStart !== selectionEnd) return;

    const value = input.value;
    const lineStart = value.lastIndexOf("\n", Math.max(0, selectionStart - 1)) + 1;
    const currentLineBeforeCursor = value.slice(lineStart, selectionStart);
    const xCount = (normalizeWorkoutLine(currentLineBeforeCursor).match(/(?:^|\s)x(?:\s|$)/gi) || []).length;

    if (!/\d$/.test(currentLineBeforeCursor) || xCount >= 2) return;

    event.preventDefault();
    const inserted = " x ";
    const nextValue = `${value.slice(0, selectionStart)}${inserted}${value.slice(selectionEnd)}`;
    const nextCursor = selectionStart + inserted.length;
    updateWorkout({
      memo: nextValue,
      selecting: false,
      completed: false,
      selections: {},
      targets: [],
    });
    setMemoCursor(nextCursor);

    window.requestAnimationFrame(() => {
      memoRef.current?.focus();
      memoRef.current?.setSelectionRange(nextCursor, nextCursor);
    });
  };

  const applyExerciseSuggestion = (exerciseName) => {
    const value = workout?.memo || "";
    const { lineStart, lineEnd } = getCurrentLineInfo(value, memoCursor);
    const nextValue = `${value.slice(0, lineStart)}${exerciseName}${value.slice(lineEnd)}`;
    const nextCursor = lineStart + exerciseName.length;
    updateWorkout({
      memo: nextValue,
      selecting: false,
      completed: false,
      selections: {},
      targets: [],
    });
    setMemoCursor(nextCursor);
    setMemoFocused(true);

    window.requestAnimationFrame(() => {
      memoRef.current?.focus();
      memoRef.current?.setSelectionRange(nextCursor, nextCursor);
    });
  };

  return (
    <div className="workout-screen">
      {!selecting && (
        <section
          className={`workout-bodypart-card${workout?.completed ? " is-complete" : ""}`}
          {...(workout?.completed ? completedLongPressProps : {})}
        >
          <label className="workout-bodypart-label" htmlFor="workout-bodypart-input">운동 부위</label>
          <div className="workout-autocomplete-wrap">
            <input
              id="workout-bodypart-input"
              className="workout-bodypart-input"
              type="text"
              value={bodyPart}
              onChange={(event) => updateWorkout({ bodyPart: event.target.value, completed: false })}
              onFocus={() => setBodyPartFocused(true)}
              onBlur={() => window.setTimeout(() => setBodyPartFocused(false), 120)}
              placeholder="예: 가슴, 등, 어깨"
              autoComplete="off"
              disabled={workout?.completed}
            />
            {bodyPartSuggestions.length > 0 && (
              <div className="workout-autocomplete-list" role="listbox" aria-label="운동 부위 이전 기록">
                {bodyPartSuggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      updateWorkout({ bodyPart: suggestion, completed: false });
                      setBodyPartFocused(false);
                    }}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      <section className="workout-memo-card">
        <div className="section-title workout-title-row">
          <strong>운동 메모</strong>
          {workout?.completed && <span className="workout-saved-badge">저장됨</span>}
        </div>

        {!selecting && !workout?.completed ? (
          <div className="workout-memo-input-wrap">
            <textarea
              ref={memoRef}
              className="workout-memo-input"
              value={workout?.memo || ""}
              onChange={handleMemoChange}
              onKeyDown={handleMemoKeyDown}
              onClick={handleMemoSelection}
              onKeyUp={handleMemoSelection}
              onSelect={handleMemoSelection}
              onFocus={(event) => {
                setMemoFocused(true);
                setMemoCursor(event.currentTarget.selectionStart || 0);
              }}
              onBlur={() => window.setTimeout(() => setMemoFocused(false), 120)}
              placeholder={"스쿼트\n140 x 5 x 1\n160 x 5 x 3\n\n인클라인 덤벨프레스\n35 x 10 x 3"}
              spellCheck={false}
            />
            {exerciseSuggestions.length > 0 && (
              <div className="workout-autocomplete-list workout-exercise-suggestions" role="listbox" aria-label="운동 이름 이전 기록">
                {exerciseSuggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => applyExerciseSuggestion(suggestion)}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : selecting ? (
          <div className="workout-selection-list">
            <p className="workout-selection-guide">점진적 과부하를 적용할 운동과 세트만 선택하세요.</p>
            {parsed.map((exercise) => {
              const exerciseSelection = selections[exercise.id];
              const equipmentValue = equipmentByExercise[normalizeHistoryKey(exercise.name)] || exerciseSelection?.equipment || history.equipmentByExercise?.[normalizeHistoryKey(exercise.name)] || "";
              return (
                <article className="workout-exercise-block" key={exercise.id}>
                  <div className="workout-exercise-head">
                    <label className="workout-exercise-check">
                      <input
                        type="checkbox"
                        checked={Boolean(exerciseSelection)}
                        onChange={() => toggleExercise(exercise)}
                      />
                      <strong>{exercise.name}</strong>
                    </label>
                    <select
                      className="workout-equipment-select"
                      value={equipmentValue}
                      onChange={(event) => changeEquipment(exercise, event.target.value)}
                      aria-label={`${exercise.name} 운동 기구 분류`}
                    >
                      <option value="">구분</option>
                      {EQUIPMENT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </div>

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
        ) : (
          <div
            className="workout-completed-memo"
            aria-label="저장된 운동 메모"
            {...completedLongPressProps}
          >
            {completedMemoRows.map((row) => (
              <div
                className={`workout-completed-memo-row${row.selected ? " is-growth-set" : ""}`}
                key={row.key}
              >
                {row.text || "\u00a0"}
              </div>
            ))}
          </div>
        )}

        <div className="workout-memo-actions">
          {!selecting && !workout?.completed && (
            <button
              className="workout-complete-button"
              type="button"
              onClick={startSelection}
              disabled={parsed.length === 0}
            >
              오늘 운동 완료
            </button>
          )}
          {selecting && (
            <button
              className="workout-complete-button"
              type="button"
              onClick={saveWorkout}
              disabled={selectedSetCount === 0}
            >
              오늘 기록 저장
            </button>
          )}
          {workout?.completed && (
            <button
              className="workout-complete-button is-complete"
              type="button"
              aria-label="오늘 운동 완성됨. 길게 눌러 수정"
              {...completedLongPressProps}
            >
              오늘 운동 완성됨
            </button>
          )}
        </div>
      </section>

      {selecting && (
        <div className="workout-selected-summary">
          선택한 성장 관리 세트
          <strong>{bodyPart.trim() || "부위 미선택"}{selectedSetCount > 0 ? ` · ${selectedSetCount}세트` : ""}</strong>
        </div>
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
