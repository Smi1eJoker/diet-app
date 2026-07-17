export function normalizeWorkoutLine(value) {
  return String(value || "")
    .replace(/[×＊*']/g, "x")
    .replace(/\s*\+\s*/g, "+")
    .replace(/\s+/g, " ")
    .trim();
}

const NUMBER_TOKEN = "[+-]?\\d+(?:\\.\\d+)?";
const COMPOUND_NUMBER_TOKEN = `${NUMBER_TOKEN}(?:\\+${NUMBER_TOKEN})*`;

function parseCompoundNumber(value) {
  const parts = String(value || "")
    .split("+")
    .map((part) => Number(part))
    .filter((part) => Number.isFinite(part));

  return {
    values: parts,
    primary: parts[0] ?? 0,
    text: String(value || ""),
  };
}

export function parseWorkoutSetText(text) {
  const line = normalizeWorkoutLine(text);
  const fullPattern = new RegExp(
    `^(${COMPOUND_NUMBER_TOKEN})\\s*(?:kg)?\\s*x\\s*(${COMPOUND_NUMBER_TOKEN})\\s*(?:회)?(?:\\s*x\\s*(\\d+)\\s*(?:세트)?)?$`,
    "i",
  );
  const repsOnlyPattern = new RegExp(`^(${COMPOUND_NUMBER_TOKEN})\\s*(?:회)?$`, "i");

  const fullMatch = line.match(fullPattern);
  if (fullMatch) {
    const weight = parseCompoundNumber(fullMatch[1]);
    const reps = parseCompoundNumber(fullMatch[2]);
    return {
      weight: weight.primary,
      weightValues: weight.values,
      weightText: weight.text,
      reps: reps.primary,
      repsValues: reps.values,
      repsText: reps.text,
      sets: fullMatch[3] ? Number(fullMatch[3]) : 1,
      raw: text.trim(),
    };
  }

  const repsOnlyMatch = line.match(repsOnlyPattern);
  if (!repsOnlyMatch) return null;
  const reps = parseCompoundNumber(repsOnlyMatch[1]);
  return {
    weight: 0,
    weightValues: [],
    weightText: "",
    reps: reps.primary,
    repsValues: reps.values,
    repsText: reps.text,
    sets: 1,
    raw: text.trim(),
  };
}

export function parseInlineWorkoutExercise(line) {
  const normalized = normalizeWorkoutLine(line);
  const pattern = new RegExp(
    `^(.+?)\\s+(${COMPOUND_NUMBER_TOKEN})\\s*(?:kg)?\\s*x\\s*(${COMPOUND_NUMBER_TOKEN})\\s*(?:회)?(?:\\s*x\\s*(\\d+)\\s*(?:세트)?)?$`,
    "i",
  );
  const match = normalized.match(pattern);
  if (!match || !/[가-힣a-zA-Z]/.test(match[1])) return null;

  const weight = parseCompoundNumber(match[2]);
  const reps = parseCompoundNumber(match[3]);
  return {
    name: match[1].trim(),
    set: {
      weight: weight.primary,
      weightValues: weight.values,
      weightText: weight.text,
      reps: reps.primary,
      repsValues: reps.values,
      repsText: reps.text,
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
