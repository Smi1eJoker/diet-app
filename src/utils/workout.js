export function normalizeWorkoutLine(value) {
  return String(value || "").replace(/[×＊*']/g, "x").replace(/\s+/g, " ").trim();
}

export function parseWorkoutSetText(text) {
  const line = normalizeWorkoutLine(text);
  const match = line.match(/^(?:(\d+(?:\.\d+)?)\s*(?:kg)?\s*x\s*)?(\d+)\s*(?:회)?(?:\s*x\s*(\d+)\s*(?:세트)?)?$/i);
  if (!match) return null;
  return {
    weight: match[1] ? Number(match[1]) : 0,
    reps: Number(match[2]),
    sets: match[3] ? Number(match[3]) : 1,
    raw: text.trim(),
  };
}

export function parseInlineWorkoutExercise(line) {
  const match = normalizeWorkoutLine(line).match(/^(.+?)\s+(?:(\d+(?:\.\d+)?)\s*(?:kg)?\s*x\s*)?(\d+)\s*(?:회)?(?:\s*x\s*(\d+)\s*(?:세트)?)?$/i);
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

    const set = parseWorkoutSetText(line);
    if (set && current) {
      current.sets.push({ ...set, id: `${current.id}-set-${current.sets.length}` });
      return;
    }

    const inline = parseInlineWorkoutExercise(line);
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
