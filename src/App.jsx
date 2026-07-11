import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { DEFAULT_PROFILE, GOAL_OPTIONS, JOB_ACTIVITY_OPTIONS, MEMO_EXAMPLE_ROWS } from "./constants/app";
import {
  HAS_SUPABASE_CONFIG,
  deleteUserAlias,
  deleteUserFood,
  deleteUserFoodUnit,
  fetchFoodDatabase,
  fetchUserAppState,
  fetchUserDailyLogs,
  getSessionExpiresAtMs,
  isJwtExpiredError,
  isSessionExpiringSoon,
  loadStoredSession,
  mergeAuthSession,
  refreshSupabaseSession,
  saveStoredSession,
  searchExternalFoods,
  signInWithEmail,
  signOutFromSupabase,
  signUpWithEmail,
  updateUserFood,
  updateUserFoodUnit,
  upsertUserAlias,
  upsertUserAppState,
  upsertUserDailyLog,
  upsertUserFood,
  upsertUserFoodUnit,
} from "./lib/supabaseApi";
import MealCard from "./components/MealCard";
import MyFoodsScreen from "./components/MyFoodsScreen";
import StatsScreen from "./components/StatsScreen";
import { MacroLegend } from "./components/summary";
import { Modal, ModalActions } from "./components/modals/Modal";
import { addDays, getDateKey, isSameDate } from "./utils/date";
import { buildStats } from "./utils/stats";
import {
  applyManualTargets,
  balanceTargetValues,
  buildNutritionPlan,
  calculateTotals,
  cleanIntegerInput,
  formatAmount,
  formatMacro,
  getGapTone,
  getMacroIntakeStatus,
  getMacroCalorieGap,
  getMacroCalories,
  maybeApplyAdaptiveCalories,
  getTargetFormValues,
  isRequiredProfileFilled,
  targetValuesToForm,
  toNumber,
} from "./utils/nutrition";
import {
  applyFoodBasisToItem,
  buildMemoBasisMapFromMeals,
  cleanFoodName,
  dedupeFoodMatches,
  findExactFoodByName,
  findFoodByName,
  findFoodMatchesExpanded,
  getFoodBasisSnapshotFromItem,
  getFoodDisplayName,
  getFoodMatchKey,
  getManagedUserAliases,
  getManagedUserFoods,
  getManagedUserUnits,
  getMemoBasisKey,
  getMemoSegmentIndex,
  getPreparedUserFoodFromForm,
  makeUserFoodFormFromFood,
  mergeManagedUserFood,
  mergeUserFoodUnitIntoMap,
  normalize,
  removeManagedAliasFromMap,
  removeManagedUserFoodFromMap,
  removeUserFoodUnitFromMap,
  resolveItem,
  splitMemoPreviewFoodName,
  toFoodEntry,
} from "./utils/foodMatch";
import {
  appendMemoFoods,
  buildDailyMemoFromRows,
  buildMemoUnitOverrideMapFromMeals,
  createItem,
  formatTimeDraft,
  itemToMemoLine,
  mealToDailyMemoLine,
  mealsToDailyMemo,
  mergeMealsWithSameTime,
  parseAttachedFoodUnitToken,
  parseDailyMemoInput,
  parseQuantityUnitToken,
  parseQuantityUnitTokens,
  parseTimeInput,
  sortMealsLatestFirst,
  splitDailyMemoRows,
} from "./utils/foodParser";
import useLongPress from "./hooks/useLongPress";

const MEMO_PREVIEW_FOOD_LIMIT = 5;

function hasQuantityInMemoSegment(segment) {
  const tokens = String(segment || "").trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;

  return tokens.some((token, index) => {
    const previousToken = tokens[index - 1] || "";

    if (/^[0-9]+(?:\.[0-9]+)?$/i.test(token)) return true;
    if (/^[0-9]+(?:\.[0-9]+)?(?:g|그램)$/i.test(token)) return true;
    if (/^(g|그램)$/i.test(token) && /^[0-9]+(?:\.[0-9]+)?$/i.test(previousToken)) return true;

    const compactUnit = parseQuantityUnitToken(token);
    if (compactUnit?.quantity > 0 && compactUnit.unitText) return true;

    const separatedUnit = index > 0 ? parseQuantityUnitTokens(previousToken, token) : null;
    if (separatedUnit?.quantity > 0 && separatedUnit.unitText) return true;

    const attachedUnit = parseAttachedFoodUnitToken(token);
    if (attachedUnit?.quantity > 0 && attachedUnit.unitText) return true;

    return false;
  });
}

const EMPTY_EXTERNAL_SEARCH_STATE = {
  query: "",
  results: [],
  loading: false,
  error: "",
  searched: false,
};

function getExternalFoodPer100Value(food, key) {
  const per100Key = key + "Per100g";
  return toNumber(food?.[per100Key] ?? food?.[key]);
}

function makeExternalFoodBasis(food, fallbackName = "") {
  const foodName = cleanFoodName(food?.name || fallbackName);
  const sourceKey = cleanFoodName(food?.sourceFoodCode || food?.id || foodName);

  return {
    id: "external-" + normalize([food?.externalFoodId || food?.source || "external", sourceKey || foodName].join("-")),
    name: foodName,
    kcal: getExternalFoodPer100Value(food, "kcal"),
    carb: getExternalFoodPer100Value(food, "carb"),
    protein: getExternalFoodPer100Value(food, "protein"),
    fat: getExternalFoodPer100Value(food, "fat"),
    source: "external_food",
    externalSource: food?.source || "external_food",
    externalFoodId: food?.externalFoodId || food?.sourceFoodCode || "",
    externalSourceLabel: food?.sourceLabel || "외부 음식 DB",
  };
}

function makeMyFoodFormFromExternalFood(food) {
  const basisFood = makeExternalFoodBasis(food);

  return {
    name: basisFood.name,
    baseAmount: "100",
    kcal: basisFood.kcal ? String(Math.round(basisFood.kcal)) : "",
    carb: basisFood.carb ? formatMacro(basisFood.carb) : "",
    protein: basisFood.protein ? formatMacro(basisFood.protein) : "",
    fat: basisFood.fat ? formatMacro(basisFood.fat) : "",
  };
}

function getExternalFoodMetaText(food) {
  return [food?.maker, food?.category, food?.sourceLabel || "외부 음식 DB"].filter(Boolean).join(" · ");
}

const TRAINING_GOALS = {
  strength: { label: "스트렝스", repMin: 3, repMax: 6, targetRir: 2, firstLoadRatio: 0.8 },
  hypertrophy: { label: "근비대", repMin: 6, repMax: 15, targetRir: 2, firstLoadRatio: 0.7 },
  endurance: { label: "근지구력", repMin: 15, repMax: 30, targetRir: 2, firstLoadRatio: 0.55 },
};

const EQUIPMENT_OPTIONS = {
  barbell: "바벨",
  dumbbell: "덤벨",
  machine: "머신",
  cable: "케이블",
  bodyweight: "맨몸",
  other: "기타",
};

const MUSCLE_GROUP_LABELS = {
  chest: "가슴",
  back: "등",
  shoulders: "어깨",
  biceps: "이두",
  triceps: "삼두",
  quads: "대퇴사두",
  hamstrings: "햄스트링",
  glutes: "둔근",
  calves: "종아리",
};

const EXERCISE_MUSCLE_RULES = [
  { keys: ["벤치프레스", "체스트프레스", "덤벨프레스", "플라이", "펙덱"], direct: ["chest"], indirect: ["triceps", "shoulders"] },
  { keys: ["오버헤드프레스", "밀리터리프레스", "숄더프레스", "ohp"], direct: ["shoulders"], indirect: ["triceps"] },
  { keys: ["레터럴레이즈", "사이드레터럴", "리어델트", "벤트오버레이즈"], direct: ["shoulders"], indirect: [] },
  { keys: ["랫풀다운", "풀업", "친업", "바벨로우", "덤벨로우", "시티드로우", "케이블로우", "티바로우"], direct: ["back"], indirect: ["biceps"] },
  { keys: ["풀오버"], direct: ["back"], indirect: ["chest"] },
  { keys: ["바벨컬", "덤벨컬", "해머컬", "프리처컬", "암컬"], direct: ["biceps"], indirect: [] },
  { keys: ["푸시다운", "트라이셉스", "삼두", "스컬크러셔", "라잉익스텐션"], direct: ["triceps"], indirect: [] },
  { keys: ["스쿼트", "레그프레스", "핵스쿼트", "레그익스텐션", "런지"], direct: ["quads", "glutes"], indirect: ["hamstrings"] },
  { keys: ["루마니안데드리프트", "rdl", "레그컬", "스티프데드리프트"], direct: ["hamstrings", "glutes"], indirect: ["back"] },
  { keys: ["데드리프트"], direct: ["hamstrings", "glutes", "back"], indirect: ["quads"] },
  { keys: ["힙쓰러스트", "글루트브리지", "힙어브덕션"], direct: ["glutes"], indirect: ["hamstrings"] },
  { keys: ["카프레이즈", "종아리"], direct: ["calves"], indirect: [] },
];

function normalizeExerciseName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[()\[\]{}]/g, "")
    .replace(/[·ㆍ.,/\\_-]/g, "")
    .replace(/\s+/g, "");
}

function getCoreLiftKey(name) {
  const normalizedName = normalizeExerciseName(name);
  const aliases = {
    squat: ["스쿼트", "백스쿼트", "바벨스쿼트", "backsquat", "squat"],
    bench: ["벤치프레스", "바벨벤치프레스", "플랫벤치프레스", "benchpress", "bench"],
    deadlift: ["데드리프트", "컨벤셔널데드리프트", "conventionaldeadlift", "deadlift"],
    ohp: ["ohp", "오버헤드프레스", "밀리터리프레스", "바벨오버헤드프레스", "overheadpress"],
  };

  return Object.entries(aliases).find(([, names]) => names.includes(normalizedName))?.[0] || "";
}

function getExerciseIncrement(name) {
  const coreLift = getCoreLiftKey(name);
  if (coreLift === "squat" || coreLift === "deadlift") return 5;
  return 2.5;
}

function roundToIncrement(value, increment = 2.5) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.max(increment, Math.round(value / increment) * increment);
}

function parseWorkoutSetLine(line) {
  const match = String(line || "").trim().match(
    /^(\d+(?:\.\d+)?)\s*(?:kg)?\s*(?:[x×*]\s*)?(\d+)(?:\s*(?:@|rir\s*)(\d+(?:\.\d+)?))?$/i
  );
  if (!match) return null;

  return {
    weight: Number(match[1]),
    reps: Number(match[2]),
    rir: match[3] === undefined ? null : Number(match[3]),
  };
}

function parseWorkoutMemo(value) {
  const exercises = [];
  let currentExercise = null;

  String(value || "").split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) return;

    const parsedSet = parseWorkoutSetLine(line);
    if (parsedSet && currentExercise) {
      currentExercise.sets.push(parsedSet);
      return;
    }

    if (!parsedSet) {
      currentExercise = {
        id: "exercise-" + normalizeExerciseName(line),
        name: line,
        sets: [],
      };
      exercises.push(currentExercise);
    }
  });

  return exercises;
}

function formatWorkoutNumber(value) {
  return Number.isInteger(Number(value)) ? String(Number(value)) : String(Number(value).toFixed(1)).replace(/\.0$/, "");
}

function formatWorkoutMemo(exercises) {
  return (exercises || [])
    .map((exercise) => [
      exercise.name,
      ...(exercise.sets || []).map((set) => {
        const rirText = set.rir === null || set.rir === undefined ? "" : " @" + formatWorkoutNumber(set.rir);
        return `${formatWorkoutNumber(set.weight)} ${set.reps}${rirText}`;
      }),
    ].join("\n"))
    .join("\n\n");
}

function findPreviousExercise(dailyRecords, selectedDateKey, exerciseName, equipment = "") {
  const targetName = normalizeExerciseName(exerciseName);
  const earlierDateKeys = Object.keys(dailyRecords || {})
    .filter((dateKey) => dateKey < selectedDateKey)
    .sort((a, b) => b.localeCompare(a));

  for (const dateKey of earlierDateKeys) {
    const entries = dailyRecords[dateKey]?.workoutEntries;
    const match = Array.isArray(entries)
      ? entries.find((entry) => {
          const sameName = normalizeExerciseName(entry.name) === targetName;
          const sameEquipment = !equipment || !entry.equipment || entry.equipment === equipment;
          return sameName && sameEquipment && entry.sets?.length > 0;
        })
      : null;
    if (match) return { ...match, dateKey, sessionMeta: dailyRecords[dateKey]?.workoutSession || {} };
  }

  return null;
}

function getExerciseHistory(dailyRecords, selectedDateKey, exerciseName, equipment = "", includeSelectedDate = false) {
  const targetName = normalizeExerciseName(exerciseName);
  return Object.keys(dailyRecords || {})
    .filter((dateKey) => includeSelectedDate ? dateKey <= selectedDateKey : dateKey < selectedDateKey)
    .sort((a, b) => b.localeCompare(a))
    .flatMap((dateKey) => {
      const entries = dailyRecords[dateKey]?.workoutEntries;
      if (!Array.isArray(entries)) return [];
      const match = entries.find((entry) => {
        const sameName = normalizeExerciseName(entry.name) === targetName;
        const sameEquipment = !equipment || !entry.equipment || entry.equipment === equipment;
        return sameName && sameEquipment && entry.sets?.length > 0;
      });
      return match ? [{ ...match, dateKey, sessionMeta: dailyRecords[dateKey]?.workoutSession || {} }] : [];
    });
}

function getExerciseMuscleMap(exerciseName) {
  const normalizedName = normalizeExerciseName(exerciseName);
  const rule = EXERCISE_MUSCLE_RULES.find((item) => item.keys.some((key) => normalizedName.includes(normalizeExerciseName(key))));
  return rule || { direct: [], indirect: [] };
}

function getSetStimulusWeight(set) {
  if (set?.rir === null || set?.rir === undefined) return 1;
  if (set.rir <= 3) return 1;
  if (set.rir === 4) return 0.5;
  return 0;
}

function calculateWeeklyVolume(dailyRecords, selectedDateKey, currentEntries = []) {
  const selectedDate = new Date(`${selectedDateKey}T12:00:00`);
  const volume = Object.keys(MUSCLE_GROUP_LABELS).reduce((acc, key) => ({ ...acc, [key]: { direct: 0, indirect: 0 } }), {});
  let mappedSets = 0;
  let totalSets = 0;

  const entriesByDate = Object.keys(dailyRecords || {})
    .filter((dateKey) => {
      const targetDate = new Date(`${dateKey}T12:00:00`);
      const difference = Math.round((selectedDate - targetDate) / 86400000);
      return difference >= 0 && difference <= 6;
    })
    .reduce((acc, dateKey) => ({ ...acc, [dateKey]: dailyRecords[dateKey]?.workoutEntries || [] }), {});

  if (currentEntries.some((entry) => entry.sets?.length > 0)) entriesByDate[selectedDateKey] = currentEntries;

  Object.values(entriesByDate).flat().forEach((exercise) => {
    const muscles = getExerciseMuscleMap(exercise.name);
    const stimulusSets = (exercise.sets || []).reduce((sum, set) => sum + getSetStimulusWeight(set), 0);
    totalSets += (exercise.sets || []).length;
    if (muscles.direct.length || muscles.indirect.length) mappedSets += (exercise.sets || []).length;
    muscles.direct.forEach((muscle) => { volume[muscle].direct += stimulusSets; });
    muscles.indirect.forEach((muscle) => { volume[muscle].indirect += stimulusSets * 0.5; });
  });

  return {
    rows: Object.entries(volume)
      .map(([key, value]) => ({ key, label: MUSCLE_GROUP_LABELS[key], ...value, total: value.direct + value.indirect }))
      .filter((row) => row.total > 0)
      .sort((a, b) => b.total - a.total),
    mappingConfidence: totalSets > 0 ? mappedSets / totalSets : 0,
  };
}

function getExerciseSetting(profile, exerciseName) {
  const exerciseKey = normalizeExerciseName(exerciseName);
  const savedSetting = profile.exerciseSettings?.[exerciseKey] || {};
  const trainingGoal = savedSetting.trainingGoal || profile.trainingGoal || "hypertrophy";

  return {
    trainingGoal,
    progressionMode: savedSetting.progressionMode || profile.progressionMode || "reps",
    equipment: savedSetting.equipment || "",
    ...(TRAINING_GOALS[trainingGoal] || TRAINING_GOALS.hypertrophy),
  };
}

function calculateSetE1RM(set) {
  if (!set || set.weight <= 0 || set.reps <= 0 || set.reps > 10) return 0;
  const safeRir = set.rir === null || set.rir === undefined ? 0 : Math.max(0, Math.min(4, set.rir));
  return set.weight * (1 + (set.reps + safeRir) / 30);
}

function calculateExerciseE1RM(exercise) {
  if (!getCoreLiftKey(exercise?.name)) return 0;
  return Math.max(0, ...(exercise?.sets || []).map(calculateSetE1RM));
}

function estimateSetRIR(set, reference1RM) {
  if (!set || reference1RM <= 0 || set.weight <= 0 || set.reps <= 0) return null;
  const estimatedMaxReps = 30 * (reference1RM / set.weight - 1);
  return Math.max(0, Math.min(5, Math.round(estimatedMaxReps - set.reps)));
}

function getRollingE1RM(history, currentExercise = null) {
  const candidates = [
    ...(currentExercise?.sets?.length ? [{ ...currentExercise, dateKey: "current" }] : []),
    ...(history || []),
  ]
    .map((entry) => ({ dateKey: entry.dateKey, value: calculateExerciseE1RM(entry) }))
    .filter((entry) => entry.value > 0)
    .slice(0, 3);

  if (candidates.length === 0) return { value: 0, trendPercent: 0, samples: 0 };
  const weights = candidates.length === 1 ? [1] : candidates.length === 2 ? [0.65, 0.35] : [0.5, 0.3, 0.2];
  const value = candidates.reduce((sum, entry, index) => sum + entry.value * weights[index], 0) / weights.slice(0, candidates.length).reduce((a, b) => a + b, 0);
  const oldest = candidates[candidates.length - 1]?.value || value;
  return {
    value,
    trendPercent: oldest > 0 ? ((candidates[0].value - oldest) / oldest) * 100 : 0,
    samples: candidates.length,
  };
}

function getRirReliability(history, currentExercise = null) {
  const sets = [
    ...(currentExercise?.sets || []),
    ...(history || []).slice(0, 3).flatMap((entry) => entry.sets || []),
  ];
  if (sets.length === 0) return { level: "low", label: "낮음", coverage: 0 };
  const recorded = sets.filter((set) => set.rir !== null && set.rir !== undefined).length;
  const coverage = recorded / sets.length;
  if (sets.length >= 6 && coverage >= 0.8) return { level: "high", label: "높음", coverage };
  if (sets.length >= 3 && coverage >= 0.4) return { level: "medium", label: "보통", coverage };
  return { level: "low", label: "낮음", coverage };
}

function evaluateRecommendationOutcome(entry) {
  const recommendation = entry?.recommendation;
  if (!recommendation?.sets?.length || !entry?.sets?.length) return null;
  const comparedCount = Math.min(recommendation.sets.length, entry.sets.length);
  const achieved = entry.sets.slice(0, comparedCount).every((actual, index) => {
    const target = recommendation.sets[index];
    const targetMet = actual.weight >= target.weight && actual.reps >= target.reps;
    const effortAcceptable = actual.rir === null || actual.rir === undefined || actual.rir >= Math.max(0, (target.rir ?? 2) - 1);
    return targetMet && effortAcceptable;
  });
  return achieved && entry.sets.length >= recommendation.sets.length ? "success" : "miss";
}

function getRecommendationAccuracy(dailyRecords) {
  const entries = Object.values(dailyRecords || {}).flatMap((record) => record?.workoutEntries || []);
  const evaluated = entries.map(evaluateRecommendationOutcome).filter(Boolean);
  const successes = evaluated.filter((result) => result === "success").length;
  return {
    attempts: evaluated.length,
    successes,
    rate: evaluated.length > 0 ? Math.round((successes / evaluated.length) * 100) : 0,
  };
}

function getConsecutiveMisses(history) {
  let misses = 0;
  for (const entry of history || []) {
    const outcome = evaluateRecommendationOutcome(entry);
    if (outcome === "miss") misses += 1;
    else if (outcome === "success") break;
    else if (entry.sessionMeta?.readiness === "fatigued") misses += 1;
    else break;
  }
  return misses;
}

function getRepDropAnalysis(exercise) {
  const sets = exercise?.sets || [];
  if (sets.length < 2 || sets[0].reps <= 0) return null;
  const comparable = sets.filter((set) => Math.abs(set.weight - sets[0].weight) < 0.01);
  if (comparable.length < 2) return null;
  const dropPercent = Math.max(0, ((comparable[0].reps - comparable[comparable.length - 1].reps) / comparable[0].reps) * 100);
  return {
    dropPercent,
    level: dropPercent >= 30 ? "high" : dropPercent >= 15 ? "medium" : "normal",
  };
}

function getFatigueAnalysis(history, rollingE1RM) {
  const misses = getConsecutiveMisses(history);
  const lastSession = history?.[0];
  const readinessFatigued = lastSession?.sessionMeta?.readiness === "fatigued";
  const painFlag = Boolean(lastSession?.sessionMeta?.painFlag);
  const negativeTrend = rollingE1RM.samples >= 3 && rollingE1RM.trendPercent <= -3;
  const high = painFlag || misses >= 2 || (readinessFatigued && negativeTrend);
  const medium = !high && (misses === 1 || readinessFatigued || negativeTrend);

  return {
    level: high ? "high" : medium ? "medium" : "normal",
    misses,
    painFlag,
    negativeTrend,
    message: painFlag
      ? "이전 기록에 통증이 표시되어 자동 증량을 보류해요."
      : high
        ? "연속 부진과 회복 상태를 보면 회복 조정이 필요할 가능성이 높아요."
        : medium
          ? "일시적 피로 가능성이 있어 한 번 더 추세를 확인해요."
          : "최근 기록에서 뚜렷한 누적 피로 신호는 없어요.",
  };
}

function getRecommendationConfidence(history, rirReliability, equipment) {
  let score = 0;
  if ((history || []).length >= 3) score += 2;
  else if ((history || []).length >= 1) score += 1;
  if (rirReliability.level === "high") score += 2;
  else if (rirReliability.level === "medium") score += 1;
  if (equipment) score += 1;
  const evaluated = (history || []).map(evaluateRecommendationOutcome).filter(Boolean);
  if (evaluated.some((outcome) => outcome === "success")) score += 1;

  if (score >= 5) return { level: "high", label: "높음", score };
  if (score >= 3) return { level: "medium", label: "보통", score };
  return { level: "low", label: "낮음", score };
}

function getBodyGoalFeedback(profile, fatigueAnalysis) {
  if (profile.goal === "lose") {
    return fatigueAnalysis.level === "normal"
      ? "감량 중에는 같은 수행을 유지하는 것도 좋은 결과예요."
      : "감량기 회복 저하 가능성을 반영해 증량보다 수행 보존을 우선해요.";
  }
  if (profile.goal === "bulk") return "벌크 중이어도 RIR과 수행이 확인될 때만 과부하를 적용해요.";
  return "유지 단계에서는 최근 수행 추세를 기준으로 보수적으로 진행해요.";
}

function getProfile1RM(profile, exerciseName) {
  const coreLift = getCoreLiftKey(exerciseName);
  if (!coreLift) return 0;
  const fieldMap = { squat: "squat1RM", bench: "bench1RM", deadlift: "deadlift1RM", ohp: "ohp1RM" };
  return toNumber(profile[fieldMap[coreLift]]);
}

function getFirstLoadGuide(profile, exerciseName) {
  const oneRm = getProfile1RM(profile, exerciseName);
  if (oneRm <= 0) return null;
  const setting = getExerciseSetting(profile, exerciseName);
  const increment = getExerciseIncrement(exerciseName);
  return {
    weight: roundToIncrement(oneRm * setting.firstLoadRatio, increment),
    reps: setting.repMin,
    label: `${setting.label} 시작 기준`,
  };
}

function buildExerciseRecommendation(previous, profile, context = {}) {
  if (!previous?.sets?.length) return null;

  const setting = getExerciseSetting(profile, previous.name);
  const increment = getExerciseIncrement(previous.name);
  const sets = previous.sets.map((set) => ({ ...set }));
  const fatigueAnalysis = context.fatigueAnalysis || { level: "normal", painFlag: false };
  const bodyGoalFeedback = getBodyGoalFeedback(profile, fatigueAnalysis);
  const rirValues = sets.map((set) => set.rir).filter((rir) => rir !== null && rir !== undefined);
  const hasAllRir = rirValues.length === sets.length;
  const tooHard = hasAllRir && rirValues.some((rir) => rir < Math.max(0, setting.targetRir - 1));

  if (fatigueAnalysis.painFlag) {
    return {
      type: "hold",
      label: "자동 증량 보류",
      reason: `${fatigueAnalysis.message} 통증이 가라앉고 동작이 정상일 때 다시 진행해요.`,
      sets,
      setting,
    };
  }

  if (fatigueAnalysis.level === "high") {
    return {
      type: "recovery",
      label: "회복 조정 -5%",
      reason: `${fatigueAnalysis.message} ${bodyGoalFeedback}`,
      sets: sets.map((set) => ({
        ...set,
        weight: roundToIncrement(set.weight * 0.95, increment),
        rir: Math.min(5, setting.targetRir + 1),
      })),
      setting,
    };
  }

  if (tooHard || fatigueAnalysis.level === "medium") {
    return {
      type: "hold",
      label: "이전 기록 유지",
      reason: tooHard
        ? `목표 RIR ${setting.targetRir}보다 여유가 적어 이번에는 중량과 반복수를 유지해요. ${bodyGoalFeedback}`
        : `${fatigueAnalysis.message} 이번에는 같은 목표를 한 번 더 수행해요. ${bodyGoalFeedback}`,
      sets,
      setting,
    };
  }

  if (setting.progressionMode === "load") {
    const nextSets = sets.map((set) => {
      const nextWeight = roundToIncrement(set.weight + increment, increment);
      const setE1RM = context.rollingE1RM?.value || calculateSetE1RM(set);
      const predictedReps = getCoreLiftKey(previous.name) && setE1RM > 0
        ? Math.floor(30 * (setE1RM / nextWeight - 1) - setting.targetRir)
        : set.reps - 2;

      return {
        ...set,
        weight: nextWeight,
        reps: Math.max(setting.repMin, Math.min(setting.repMax, predictedReps)),
        rir: setting.targetRir,
      };
    });

    return {
      type: "load",
      label: `중량 +${formatWorkoutNumber(increment)}kg`,
      reason: `중량 증가 방식을 선택해 최소 증량 단위만 올리고 ${setting.label} 반복 범위에 맞췄어요. ${bodyGoalFeedback}`,
      sets: nextSets,
      setting,
    };
  }

  const reachedRepCeiling = sets.every((set) => set.reps >= setting.repMax);
  if (reachedRepCeiling) {
    return {
      type: "load",
      label: `중량 +${formatWorkoutNumber(increment)}kg`,
      reason: `모든 세트가 반복 상한 ${setting.repMax}회에 도달해 중량을 올리고 반복 하한으로 돌아가요. ${bodyGoalFeedback}`,
      sets: sets.map((set) => ({
        ...set,
        weight: roundToIncrement(set.weight + increment, increment),
        reps: setting.repMin,
        rir: setting.targetRir,
      })),
      setting,
    };
  }

  const nextSets = sets.map((set) => ({ ...set }));
  const hasExtraReserve = hasAllRir && Math.min(...rirValues) >= setting.targetRir + 1;

  if (hasExtraReserve) {
    nextSets.forEach((set) => {
      set.reps = Math.min(setting.repMax, set.reps + 1);
      set.rir = setting.targetRir;
    });
  } else {
    const targetIndex = [...nextSets].map((set) => set.reps).lastIndexOf(Math.min(...nextSets.map((set) => set.reps)));
    nextSets[targetIndex].reps = Math.min(setting.repMax, nextSets[targetIndex].reps + 1);
    nextSets[targetIndex].rir = setting.targetRir;
  }

  return {
    type: "reps",
    label: hasExtraReserve ? "각 세트 반복 +1" : "총 반복수 +1",
    reason: hasExtraReserve
      ? `모든 세트에 목표보다 1회 이상 여유가 있어 각 세트 반복수를 올렸어요. ${bodyGoalFeedback}`
      : `과도한 증가를 피하기 위해 전체 세트에서 반복수 1회만 추가했어요. ${bodyGoalFeedback}`,
    sets: nextSets,
    setting,
  };
}

function getWarmupSets(workWeight, exerciseName) {
  if (!getCoreLiftKey(exerciseName) || workWeight <= 0) return [];
  const increment = getExerciseIncrement(exerciseName);
  const ratios = workWeight >= 100 ? [0.4, 0.6, 0.8] : [0.5, 0.7];
  const reps = ratios.length === 3 ? [5, 3, 1] : [5, 2];

  return ratios.map((ratio, index) => ({
    weight: roundToIncrement(workWeight * ratio, increment),
    reps: reps[index],
  }));
}

export default function App() {
  const [authSession, setAuthSession] = useState(() => loadStoredSession());
  const [authChecking, setAuthChecking] = useState(() => Boolean(authSession));
  const [authMode, setAuthMode] = useState("signin");
  const [authForm, setAuthForm] = useState({ email: "", password: "" });
  const [authError, setAuthError] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [setupScreen, setSetupScreen] = useState("setup");
  const [activeTab, setActiveTab] = useState("record");
  const [recordView, setRecordView] = useState("diet");
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const recordSwipeStartRef = useRef(null);
  const [recordSwipeOffset, setRecordSwipeOffset] = useState(0);
  const [recordSwipeDragging, setRecordSwipeDragging] = useState(false);
  const [recordSwipeSettling, setRecordSwipeSettling] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [dayComplete, setDayComplete] = useState(false);
  const [dailyRecords, setDailyRecords] = useState({});
  const [profile, setProfile] = useState(DEFAULT_PROFILE);
  const [nutritionPlan, setNutritionPlan] = useState(() => buildNutritionPlan(DEFAULT_PROFILE));
  const [mealsByDate, setMealsByDate] = useState({});
  const [morningWeight, setMorningWeight] = useState("");
  const [morningWeightInput, setMorningWeightInput] = useState("");
  const [customFoods, setCustomFoods] = useState({});
  const [foodDbLoading, setFoodDbLoading] = useState(false);
  const [foodDbError, setFoodDbError] = useState("");
  const [isAddingMeal, setIsAddingMeal] = useState(false);
  const [editingMealId, setEditingMealId] = useState(null);
  const [timeInput, setTimeInput] = useState("");
  const [memoInput, setMemoInput] = useState("");
  const [memoCursorIndex, setMemoCursorIndex] = useState(0);
  const [activeMemoRowIndex, setActiveMemoRowIndex] = useState(0);
  const [activeMemoFoodCursor, setActiveMemoFoodCursor] = useState(0);
  const [memoPreviewHidden, setMemoPreviewHidden] = useState(false);
  const [memoFoodBasisMap, setMemoFoodBasisMap] = useState({});
  const [formError, setFormError] = useState("");
  const [nutritionTarget, setNutritionTarget] = useState(null);
  const [matchChoiceTarget, setMatchChoiceTarget] = useState(null);
  const [nutritionForm, setNutritionForm] = useState({ name: "", baseAmount: "100", kcal: "", carb: "", protein: "", fat: "" });
  const [nutritionExternalSearch, setNutritionExternalSearch] = useState(EMPTY_EXTERNAL_SEARCH_STATE);
  const [myFoodExternalSearch, setMyFoodExternalSearch] = useState(EMPTY_EXTERNAL_SEARCH_STATE);
  const [myFoodEditTarget, setMyFoodEditTarget] = useState(null);
  const [myFoodModalOpen, setMyFoodModalOpen] = useState(false);
  const [myFoodForm, setMyFoodForm] = useState({ name: "", baseAmount: "100", kcal: "", carb: "", protein: "", fat: "" });
  const [myFoodError, setMyFoodError] = useState("");
  const [myUnitEditTarget, setMyUnitEditTarget] = useState(null);
  const [myUnitModalOpen, setMyUnitModalOpen] = useState(false);
  const [myUnitForm, setMyUnitForm] = useState({ unitName: "", grams: "" });
  const [myUnitError, setMyUnitError] = useState("");
  const [amountTarget, setAmountTarget] = useState(null);
  const [amountInput, setAmountInput] = useState("");
  const [unitAmountTarget, setUnitAmountTarget] = useState(null);
  const [unitAmountInput, setUnitAmountInput] = useState("");
  const [memoUnitOverrides, setMemoUnitOverrides] = useState({});
  const [foodEditTarget, setFoodEditTarget] = useState(null);
  const [foodEditForm, setFoodEditForm] = useState({ name: "", amount: "" });
  const [actionTarget, setActionTarget] = useState(null);
  const [cloudSyncReady, setCloudSyncReady] = useState(false);

  const memoInputRef = useRef(null);
  const dailyMemoCardRef = useRef(null);
  const memoTimeRefs = useRef([]);
  const memoFoodRefs = useRef([]);
  const skipNextMemoSyncRef = useRef(false);
  const amountInputRef = useRef(null);
  const unitAmountInputRef = useRef(null);
  const foodEditAmountRef = useRef(null);
  const cloudSaveTimerRef = useRef(null);
  const finishDayLongPressProps = useLongPress(() => setActionTarget({ type: "day" }));

  useEffect(() => {
    if (!HAS_SUPABASE_CONFIG || !authSession) {
      setAuthChecking(false);
      return;
    }

    let isMounted = true;

    const restoreSession = async () => {
      try {
        if (authSession.refresh_token && isSessionExpiringSoon(authSession, 5 * 60 * 1000)) {
          const refreshedSession = await refreshSupabaseSession(authSession.refresh_token);
          if (!isMounted) return;
          setAuthSession((current) => mergeAuthSession(current, refreshedSession));
        }
      } catch (error) {
        if (!isMounted) return;
        setAuthSession(null);
        setAuthError("로그인이 만료됐어. 다시 로그인해줘.");
      } finally {
        if (isMounted) setAuthChecking(false);
      }
    };

    restoreSession();

    return () => {
      isMounted = false;
    };
    // 첫 실행 때 저장된 세션을 복구하는 용도라 의존성은 비워둔다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!HAS_SUPABASE_CONFIG || !authSession?.refresh_token) return;

    const expiresAtMs = getSessionExpiresAtMs(authSession);
    if (!expiresAtMs) return;

    const refreshDelayMs = Math.max(1000, expiresAtMs - Date.now() - 60 * 1000);
    let isCancelled = false;

    const timerId = window.setTimeout(async () => {
      try {
        const refreshedSession = await refreshSupabaseSession(authSession.refresh_token);
        if (!isCancelled) {
          setAuthSession((current) => mergeAuthSession(current, refreshedSession));
        }
      } catch {
        if (!isCancelled) {
          setAuthSession(null);
          setAuthError("로그인이 만료됐어. 다시 로그인해줘.");
        }
      }
    }, refreshDelayMs);

    return () => {
      isCancelled = true;
      window.clearTimeout(timerId);
    };
  }, [authSession?.access_token, authSession?.refresh_token]);

  useEffect(() => {
    saveStoredSession(authSession);
  }, [authSession]);


  useEffect(() => {
    if (!authSession || !HAS_SUPABASE_CONFIG) return;

    let isMounted = true;
    setFoodDbLoading(true);
    setFoodDbError("");

    fetchFoodDatabase(authSession)
      .then((foodMap) => {
        if (!isMounted) return;
        setCustomFoods((current) => ({ ...current, ...foodMap }));
      })
      .catch((error) => {
        if (!isMounted) return;
        if (isJwtExpiredError(error)) {
          setFoodDbError("");
          return;
        }
        setFoodDbError(error.message || "음식 DB를 불러오지 못했어. 기본 내장 DB로만 동작할게.");
      })
      .finally(() => {
        if (isMounted) setFoodDbLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [authSession]);

  useEffect(() => {
    if (!authSession || !HAS_SUPABASE_CONFIG) {
      setCloudSyncReady(false);
      return;
    }

    let isMounted = true;
    setCloudSyncReady(false);

    Promise.all([fetchUserAppState(authSession), fetchUserDailyLogs(authSession)])
      .then(([appState, dailyLogState]) => {
        if (!isMounted) return;

        if (appState?.profile && Object.keys(appState.profile).length > 0) {
          setProfile({ ...DEFAULT_PROFILE, ...appState.profile });
        }

        if (appState?.nutrition_plan && Object.keys(appState.nutrition_plan).length > 0) {
          const recalculatedPlan = buildNutritionPlan({ ...DEFAULT_PROFILE, ...(appState.profile || DEFAULT_PROFILE) });
          const savedPlan = appState.nutrition_plan;
          const shouldUseSavedManualTarget = Boolean(savedPlan.isManualTarget);

          setNutritionPlan(shouldUseSavedManualTarget ? savedPlan : recalculatedPlan);
        }

        if (appState?.setup_screen) {
          setSetupScreen(appState.setup_screen);
        }

        setMealsByDate(dailyLogState.mealsByDate || {});
        setDailyRecords(dailyLogState.dailyRecords || {});
      })
      .catch((error) => {
        if (!isMounted) return;
        setFoodDbError(error.message || "기록을 불러오지 못했어. Supabase 기록 테이블을 확인해줘.");
      })
      .finally(() => {
        if (isMounted) setCloudSyncReady(true);
      });

    return () => {
      isMounted = false;
    };
  }, [authSession]);


  const selectedDateKey = getDateKey(selectedDate);
  const meals = mealsByDate[selectedDateKey] || [];
  const workoutEntries = dailyRecords[selectedDateKey]?.workoutEntries || [];
  const setMeals = (updater) => {
    setMealsByDate((current) => {
      const currentMeals = current[selectedDateKey] || [];
      const nextMeals = typeof updater === "function" ? updater(currentMeals) : updater;

      return {
        ...current,
        [selectedDateKey]: nextMeals,
      };
    });
  };

  const saveWorkoutEntries = (entries, sessionMeta = {}) => {
    setDailyRecords((current) => ({
      ...current,
      [selectedDateKey]: {
        ...current[selectedDateKey],
        workoutEntries: entries,
        workoutSession: {
          ...(current[selectedDateKey]?.workoutSession || {}),
          ...sessionMeta,
        },
        workoutUpdatedAt: new Date().toISOString(),
      },
    }));
  };

  const updateExerciseSetting = (exerciseName, field, value) => {
    const exerciseKey = normalizeExerciseName(exerciseName);
    setProfile((current) => ({
      ...current,
      exerciseSettings: {
        ...(current.exerciseSettings || {}),
        [exerciseKey]: {
          ...(current.exerciseSettings?.[exerciseKey] || {}),
          [field]: value,
        },
      },
    }));
  };

  useEffect(() => {
    if (skipNextMemoSyncRef.current) {
      skipNextMemoSyncRef.current = false;
      return;
    }

    const currentMeals = mealsByDate[selectedDateKey] || [];
    const orderedMeals = sortMealsLatestFirst(currentMeals).slice().reverse();

    setMemoInput(mealsToDailyMemo(currentMeals));
    setMemoFoodBasisMap(buildMemoBasisMapFromMeals(orderedMeals));
    setMemoUnitOverrides(buildMemoUnitOverrideMapFromMeals(orderedMeals));
    setFormError("");
    setIsAddingMeal(false);
    setEditingMealId(null);
  }, [selectedDateKey, mealsByDate]);

  useEffect(() => {
    const record = dailyRecords[selectedDateKey] || {};
    setMorningWeight(record.morningWeight ? String(record.morningWeight) : "");
    setDayComplete(Boolean(record.dayComplete));
  }, [selectedDateKey, dailyRecords]);

  const activePlan = nutritionPlan || buildNutritionPlan(profile);
  const calorieGoal = activePlan.calorieGoal;
  const macroTargets = activePlan.macroTargets;

  const updateProfileField = (field, value) => {
    setProfile((current) => ({ ...current, [field]: value }));
  };

  const calculateProfile = (event) => {
    event.preventDefault();
    if (!isRequiredProfileFilled(profile)) return;
    const nextPlan = buildNutritionPlan(profile);
    setNutritionPlan(nextPlan);
    setSetupScreen("result");
  };

  const updatePlanTargets = (targets) => {
    setNutritionPlan((current) => applyManualTargets(current || buildNutritionPlan(profile), targets));
  };

  const submitAuth = async (event) => {
    event.preventDefault();
    setAuthError("");
    setAuthMessage("");

    if (!HAS_SUPABASE_CONFIG) {
      setAuthError("Supabase URL과 publishable key를 .env에 먼저 넣어줘.");
      return;
    }

    if (!authForm.email || authForm.password.length < 6) {
      setAuthError("이메일과 6자 이상 비밀번호를 입력해줘.");
      return;
    }

    setAuthLoading(true);
    try {
      const data = authMode === "signin"
        ? await signInWithEmail(authForm.email, authForm.password)
        : await signUpWithEmail(authForm.email, authForm.password);

      if (data.access_token) {
        setAuthSession(data);
        setAuthChecking(false);
        setAuthMessage("로그인됐어.");
      } else {
        setAuthMessage("가입 메일을 확인한 뒤 로그인해줘.");
      }
    } catch (error) {
      setAuthError(error.message || "로그인에 실패했어.");
    } finally {
      setAuthLoading(false);
    }
  };

  const signOut = async () => {
    try {
      if (HAS_SUPABASE_CONFIG) await signOutFromSupabase(authSession);
    } catch {
      // Local session removal is enough if the remote sign-out request fails.
    }
    setAuthSession(null);
    setAuthChecking(false);
    setAuthMessage("");
    setAuthError("");
    setSetupScreen("setup");
    setActiveTab("record");
    setSettingsOpen(false);
    setCloudSyncReady(false);
    setMealsByDate({});
    setDailyRecords({});
    setMorningWeight("");
    setMorningWeightInput("");
    setProfile(DEFAULT_PROFILE);
    setNutritionPlan(buildNutritionPlan(DEFAULT_PROFILE));
  };

  const openProfileEditor = () => {
    setSettingsOpen(false);
    setSetupScreen("setup");
  };

  const selectCalendarDate = (date) => {
    const nextRecord = dailyRecords[getDateKey(date)] || {};
    setSelectedDate(date);
    setMorningWeight(nextRecord.morningWeight ? String(nextRecord.morningWeight) : "");
    setMorningWeightInput("");
    setDayComplete(Boolean(nextRecord.dayComplete));
    setIsAddingMeal(false);
    setEditingMealId(null);
  };

  const isRecordSwipeIgnoredTarget = (target) => {
    return Boolean(target?.closest?.(
      "input, textarea, select, button, a, .modal-backdrop, .sheet-backdrop, .bottom-nav, .app-footer-actions, .weight-line-chart, .my-foods-screen, .workout-exercise-card"
    ));
  };

  const resetRecordSwipe = () => {
    recordSwipeStartRef.current = null;
    setRecordSwipeOffset(0);
    setRecordSwipeDragging(false);
    setRecordSwipeSettling(false);
  };

  const handleRecordSwipePointerDown = (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (activeTab !== "record" || calendarOpen || settingsOpen || matchChoiceTarget || actionTarget) {
      recordSwipeStartRef.current = null;
      return;
    }

    if (isRecordSwipeIgnoredTarget(event.target)) {
      recordSwipeStartRef.current = null;
      return;
    }

    recordSwipeStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      isHorizontal: false,
    };
    setRecordSwipeSettling(false);
  };

  const handleRecordSwipePointerMove = (event) => {
    const start = recordSwipeStartRef.current;
    if (!start) return;

    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);

    if (!start.isHorizontal) {
      if (absY > 12 && absY > absX) {
        resetRecordSwipe();
        return;
      }

      if (absX < 8) return;
      start.isHorizontal = true;
      setRecordSwipeDragging(true);
    }

    const limitedOffset = Math.max(-96, Math.min(96, dx * 0.45));
    setRecordSwipeOffset(limitedOffset);
  };

  const handleRecordSwipePointerEnd = (event) => {
    const start = recordSwipeStartRef.current;
    recordSwipeStartRef.current = null;
    if (!start) return;

    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    const shouldMove = start.isHorizontal && Math.abs(dx) >= 64 && Math.abs(dx) > Math.abs(dy) * 1.2;
    const nextView = dx < 0 ? "workout" : "diet";
    const canMove = shouldMove && nextView !== recordView;

    setRecordSwipeSettling(true);

    if (canMove) {
      setRecordSwipeOffset(dx < 0 ? -116 : 116);
      window.setTimeout(() => {
        setRecordView(nextView);
        setRecordSwipeOffset(0);
        setRecordSwipeDragging(false);
        window.setTimeout(() => setRecordSwipeSettling(false), 180);
      }, 100);
      return;
    }

    setRecordSwipeOffset(0);
    setRecordSwipeDragging(false);
    window.setTimeout(() => setRecordSwipeSettling(false), 180);
  };

  const recordSwipeClassName = [
    "app-shell",
    activeTab === "record" ? "can-record-swipe" : "",
    recordSwipeDragging ? "is-record-swiping" : "",
    recordSwipeSettling ? "is-record-settling" : "",
  ].filter(Boolean).join(" ");

  const recordSwipeStyle = activeTab === "record"
    ? { "--record-swipe-offset": recordSwipeOffset + "px" }
    : undefined;

  const registerMorningWeight = () => {
    const nextWeight = toNumber(morningWeightInput);
    if (nextWeight <= 0) return;
    setMorningWeight(String(nextWeight));
    setDailyRecords((current) => ({
      ...current,
      [selectedDateKey]: {
        ...current[selectedDateKey],
        morningWeight: nextWeight,
      },
    }));
    setMorningWeightInput("");
  };

  const editMorningWeight = () => {
    setActionTarget(null);
    setMorningWeightInput(morningWeight);
    setMorningWeight("");
  };

  const deleteMorningWeight = () => {
    setActionTarget(null);
    if (window.confirm("오늘 공복 체중 기록을 삭제할까?")) {
      setMorningWeight("");
      setMorningWeightInput("");
      setDailyRecords((current) => ({
        ...current,
        [selectedDateKey]: {
          ...current[selectedDateKey],
          morningWeight: 0,
        },
      }));
    }
  };

  const completeDay = () => {
    setDayComplete(true);
    setIsAddingMeal(false);
    setEditingMealId(null);

    const nextDailyRecords = {
      ...dailyRecords,
      [selectedDateKey]: {
        ...dailyRecords[selectedDateKey],
        dayComplete: true,
        kcal: Math.round(totals.kcal),
        carb: totals.carb,
        protein: totals.protein,
        fat: totals.fat,
        morningWeight: toNumber(morningWeight) || dailyRecords[selectedDateKey]?.morningWeight || 0,
      },
    };

    setDailyRecords(nextDailyRecords);
    setNutritionPlan((current) => maybeApplyAdaptiveCalories(current || buildNutritionPlan(profile), nextDailyRecords, selectedDate));
    window.alert("오늘 하루 식단을 완성했어.");
  };

  const editCompletedDay = () => {
    setActionTarget(null);
    setDayComplete(false);
    setDailyRecords((current) => ({
      ...current,
      [selectedDateKey]: {
        ...current[selectedDateKey],
        dayComplete: false,
      },
    }));
  };

  const sortedMeals = useMemo(() => sortMealsLatestFirst(meals), [meals]);
  const totals = useMemo(() => calculateTotals(meals), [meals]);
  const stats = useMemo(() => buildStats(meals, activePlan, morningWeight, dailyRecords, selectedDate), [meals, activePlan, morningWeight, dailyRecords, selectedDate]);
  const managedUserFoods = useMemo(() => getManagedUserFoods(customFoods), [customFoods]);
  const managedUserAliases = useMemo(() => getManagedUserAliases(customFoods), [customFoods]);
  const managedUserUnits = useMemo(() => getManagedUserUnits(customFoods), [customFoods]);

  useEffect(() => {
    if (!authSession || !cloudSyncReady || !HAS_SUPABASE_CONFIG) return;

    window.clearTimeout(cloudSaveTimerRef.current);
    cloudSaveTimerRef.current = window.setTimeout(() => {
      upsertUserAppState(authSession, { profile, nutritionPlan: activePlan, setupScreen }).catch((error) => {
        setFoodDbError(error.message || "프로필 저장에 실패했어.");
      });
    }, 600);

    return () => window.clearTimeout(cloudSaveTimerRef.current);
  }, [authSession, cloudSyncReady, profile, activePlan, setupScreen]);

  useEffect(() => {
    if (!authSession || !cloudSyncReady || !HAS_SUPABASE_CONFIG) return;

    const currentRecord = dailyRecords[selectedDateKey] || {};
    const recordForSave = {
      ...currentRecord,
      dayComplete,
      kcal: Math.round(totals.kcal),
      carb: totals.carb,
      protein: totals.protein,
      fat: totals.fat,
      morningWeight: toNumber(morningWeight) || toNumber(currentRecord.morningWeight) || 0,
    };

    const timer = window.setTimeout(() => {
      upsertUserDailyLog(authSession, selectedDateKey, meals, recordForSave).catch((error) => {
        setFoodDbError(error.message || "식단 기록 저장에 실패했어.");
      });
    }, 600);

    return () => window.clearTimeout(timer);
  }, [authSession, cloudSyncReady, selectedDateKey, meals, dailyRecords, morningWeight, dayComplete, totals.kcal, totals.carb, totals.protein, totals.fat]);

  const remainingCalories = calorieGoal - totals.kcal;
  const caloriePercent = Math.min(100, Math.round((totals.kcal / calorieGoal) * 100));
  const calorieGraphColor = totals.kcal > calorieGoal ? "#ff5a4f" : "#66e36f";

  const memoRows = useMemo(() => splitDailyMemoRows(memoInput), [memoInput]);
  const hasMemoRows = memoInput.trim().length > 0;
  const shouldShowMemoExamples = !dayComplete && !hasMemoRows && meals.length === 0;
  const emptyGuideRows = MEMO_EXAMPLE_ROWS.map(() => ({ time: "", foods: "" }));
  const emptyInputRows = [{ time: "", foods: "" }];
  const baseMemoRows = hasMemoRows ? memoRows : shouldShowMemoExamples ? emptyGuideRows : emptyInputRows;
  const lastMemoRow = hasMemoRows ? (memoRows.at(-1) || { time: "", foods: "" }) : { time: "", foods: "" };
  const visibleMemoRows = dayComplete
    ? memoRows
    : !hasMemoRows
      ? baseMemoRows
      : (lastMemoRow.time || lastMemoRow.foods)
        ? [...baseMemoRows, { time: "", foods: "" }]
        : baseMemoRows;
  const activeMemoRow = visibleMemoRows[activeMemoRowIndex] || { time: "", foods: "" };
  const activeFoodCursor = Math.min(activeMemoFoodCursor, activeMemoRow.foods.length);
  const currentMemoBeforeCursor = activeMemoRow.foods.slice(0, activeFoodCursor);
  const memoCursorIsAttachedToWord = /[^\s,，]$/.test(currentMemoBeforeCursor);
  const currentMemoSegmentRaw = currentMemoBeforeCursor
    .slice(Math.max(currentMemoBeforeCursor.lastIndexOf(","), currentMemoBeforeCursor.lastIndexOf("，")) + 1);
  const currentMemoSegment = currentMemoSegmentRaw.trim();

  const memoPreviewName = useMemo(() => {
    if (!memoCursorIsAttachedToWord) return "";
    if (!currentMemoSegment) return "";
    if (hasQuantityInMemoSegment(currentMemoSegment)) return "";
    if (/^\d{1,2}:?\d{0,2}$/.test(currentMemoSegment)) return "";

    return cleanFoodName(currentMemoSegment);
  }, [currentMemoSegment, memoCursorIsAttachedToWord]);

  const deferredMemoPreviewName = useDeferredValue(memoPreviewName);
  const activeMemoPreviewName = memoPreviewName ? (deferredMemoPreviewName || memoPreviewName) : "";
  const savedPreviewFood = useMemo(
    () => activeMemoPreviewName ? findExactFoodByName(activeMemoPreviewName, customFoods) : null,
    [activeMemoPreviewName, customFoods]
  );

  const isSavedAliasPreviewFood = (food) => {
    if (!savedPreviewFood || !food) return false;

    const sameId = food.id && savedPreviewFood.id && food.id === savedPreviewFood.id;
    const sameBasis = getFoodMatchKey(food) === getFoodMatchKey(savedPreviewFood);

    return sameId || sameBasis;
  };

  const memoPreviewFoods = useMemo(
    () => activeMemoPreviewName
      ? findFoodMatchesExpanded(activeMemoPreviewName, customFoods, { limit: MEMO_PREVIEW_FOOD_LIMIT })
      : [],
    [activeMemoPreviewName, customFoods]
  );

  const showMemoDbPreview = Boolean(
    activeMemoPreviewName &&
      activeMemoRow.foods.trim() &&
      !memoPreviewHidden
  );

  const today = new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(selectedDate);
  const isViewingToday = isSameDate(selectedDate, new Date());

  const resetMealEditor = () => {
    setIsAddingMeal(false);
    setEditingMealId(null);
    setTimeInput("");
    setMemoInput("");
    setMemoFoodBasisMap({});
    setMemoUnitOverrides({});
    setFormError("");
  };

  const startNewMeal = () => {
    if (dayComplete) return;
    setIsAddingMeal(true);
    setEditingMealId(null);
    setTimeInput("");
    setMemoInput("");
    setMemoFoodBasisMap({});
    setMemoUnitOverrides({});
    setFormError("");
    requestAnimationFrame(() => memoTimeRefs.current[0]?.focus());
  };

  const startEditMeal = (mealId) => {
    const orderedMeals = sortMealsLatestFirst(meals).slice().reverse();
    const mealIndex = orderedMeals.findIndex((item) => item.id === mealId);
    const meal = mealIndex >= 0 ? orderedMeals[mealIndex] : meals.find((item) => item.id === mealId);
    if (!meal) return;

    const memoLines = orderedMeals.map(mealToDailyMemoLine);
    const nextMemo = memoLines.join("\n");
    const foodText = meal.items.map(itemToMemoLine).join(", ");

    setActionTarget(null);
    setIsAddingMeal(true);
    setEditingMealId(mealId);
    setTimeInput(meal.time);
    setMemoPreviewHidden(true);
    setMemoInput(nextMemo);
    setMemoFoodBasisMap(buildMemoBasisMapFromMeals(orderedMeals));
    setMemoUnitOverrides(buildMemoUnitOverrideMapFromMeals(orderedMeals));
    setActiveMemoRowIndex(Math.max(0, mealIndex));
    setActiveMemoFoodCursor(foodText.length);
    setFormError("");
    requestAnimationFrame(() => {
      dailyMemoCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      const target = memoFoodRefs.current[Math.max(0, mealIndex)];
      target?.focus();
      target?.setSelectionRange(0, target.value.length);
    });
  };

  const handleTimeInputChange = (event) => {
    const formatted = formatTimeDraft(event.target.value);
    if (formatted === null) return;
    setTimeInput(formatted);
  };

  const handleTimeInputKeyDown = (event) => {
    if (event.key === "Enter") {
      const normalizedTime = parseTimeInput(timeInput);

      if (normalizedTime) {
        event.preventDefault();
        setTimeInput(normalizedTime);
        setFormError("");
        requestAnimationFrame(() => memoInputRef.current?.focus());
      }

      return;
    }

    if (event.key === "Backspace") {
      const input = event.currentTarget;
      const cursorAtEnd = input.selectionStart === timeInput.length && input.selectionEnd === timeInput.length;
      if (cursorAtEnd && timeInput.endsWith(":")) {
        event.preventDefault();
        setTimeInput(timeInput.slice(0, -2));
      }
      return;
    }

    if (event.key !== " ") return;

    const digits = timeInput.replace(/\D/g, "");
    if (digits.length >= 1 && digits.length <= 2) {
      event.preventDefault();
      const hour = Math.min(Number(digits), 24);
      setTimeInput(String(hour).padStart(2, "0") + ":");
    }
  };

  const setMemoValueWithCursor = (nextValue, nextCursor) => {
    setMemoInput(nextValue);
    setMemoCursorIndex(nextCursor);

    const restoreCursor = () => {
      memoInputRef.current?.focus();
      if (memoInputRef.current) {
        memoInputRef.current.setSelectionRange(nextCursor, nextCursor);
        memoInputRef.current.scrollTop = memoInputRef.current.scrollHeight;
      }
    };

    requestAnimationFrame(restoreCursor);
    setTimeout(restoreCursor, 0);
  };

  const updateMemoCursor = (target) => {
    setMemoCursorIndex(target.selectionStart ?? memoInput.length);
  };
  const updateMemoRows = (updater, focusRequest) => {
    setMemoInput((current) => {
      const rows = splitDailyMemoRows(current);
      const nextRows = updater(rows.length > 0 ? rows : [{ time: "", foods: "" }]);
      return buildDailyMemoFromRows(nextRows);
    });

    if (focusRequest) {
      requestAnimationFrame(() => {
        const targetRef = focusRequest.field === "time" ? memoTimeRefs.current[focusRequest.index] : memoFoodRefs.current[focusRequest.index];
        targetRef?.focus();
        if (focusRequest.field === "food" && typeof focusRequest.cursor === "number") {
          targetRef?.setSelectionRange(focusRequest.cursor, focusRequest.cursor);
        }
      });
    }
  };

  const updateMemoRowField = (rowIndex, field, value) => {
    updateMemoRows((rows) => {
      const nextRows = [...rows];
      while (nextRows.length <= rowIndex) nextRows.push({ time: "", foods: "" });
      nextRows[rowIndex] = { ...nextRows[rowIndex], [field]: value };
      return nextRows;
    });
  };

  const handleMemoRowTimeChange = (rowIndex, event) => {
    const formatted = formatTimeDraft(event.target.value);
    if (formatted === null) return;
    setActiveMemoRowIndex(rowIndex);
    setMemoPreviewHidden(true);
    updateMemoRowField(rowIndex, "time", formatted);

    if (/^\d{2}:\d{2}$/.test(formatted)) {
      requestAnimationFrame(() => {
        const target = memoFoodRefs.current[rowIndex];
        target?.focus();
        const cursor = target?.value?.length || 0;
        target?.setSelectionRange(cursor, cursor);
        setActiveMemoFoodCursor(cursor);
        setMemoPreviewHidden(false);
      });
    }
  };

  const handleMemoRowTimeKeyDown = (rowIndex, event) => {
    const row = visibleMemoRows[rowIndex] || { time: "", foods: "" };

    if (event.key === " " || event.key === "Enter") {
      const normalizedTime = parseTimeInput(row.time);
      if (normalizedTime) {
        event.preventDefault();
        updateMemoRows((rows) => {
          const nextRows = [...rows];
          nextRows[rowIndex] = { ...nextRows[rowIndex], time: normalizedTime };
          return nextRows;
        }, { field: "food", index: rowIndex, cursor: row.foods.length });
      }
      return;
    }

    if (event.key === "Backspace" && row.time.endsWith(":")) {
      const input = event.currentTarget;
      if (input.selectionStart === row.time.length && input.selectionEnd === row.time.length) {
        event.preventDefault();
        updateMemoRowField(rowIndex, "time", row.time.slice(0, -1));
      }
    }
  };

  const handleMemoRowFoodChange = (rowIndex, event) => {
    const nextValue = event.target.value;
    const row = visibleMemoRows[rowIndex] || { time: "", foods: "" };

    if (!row.time && nextValue.trim() && rowIndex > 0) {
      let targetIndex = rowIndex - 1;
      while (targetIndex >= 0) {
        const targetRow = visibleMemoRows[targetIndex] || { time: "", foods: "" };
        if (targetRow.time || targetRow.foods) break;
        targetIndex -= 1;
      }

      if (targetIndex >= 0) {
        const addition = nextValue.trimStart();
        const targetRow = visibleMemoRows[targetIndex] || { time: "", foods: "" };
        const nextTargetFoods = appendMemoFoods(targetRow.foods, addition);

        updateMemoRows((rows) => {
          const nextRows = [...rows];
          while (nextRows.length <= rowIndex) nextRows.push({ time: "", foods: "" });
          nextRows[targetIndex] = {
            ...nextRows[targetIndex],
            foods: appendMemoFoods(nextRows[targetIndex]?.foods, addition),
          };
          nextRows[rowIndex] = { ...nextRows[rowIndex], foods: "" };
          return nextRows;
        }, { field: "food", index: targetIndex, cursor: nextTargetFoods.length });

        setActiveMemoRowIndex(targetIndex);
        setActiveMemoFoodCursor(nextTargetFoods.length);
        setMemoPreviewHidden(false);
        return;
      }
    }

    setActiveMemoRowIndex(rowIndex);
    setActiveMemoFoodCursor(event.target.selectionStart ?? nextValue.length);
    setMemoPreviewHidden(false);
    updateMemoRowField(rowIndex, "foods", nextValue);
  };

  const updateActiveMemoFoodCursor = (rowIndex, target) => {
    setActiveMemoRowIndex(rowIndex);
    setActiveMemoFoodCursor(target.selectionStart ?? target.value.length);
    setMemoPreviewHidden(false);
  };

  const handleMemoRowFoodKeyDown = (rowIndex, event) => {
    const target = event.currentTarget;
    const row = visibleMemoRows[rowIndex] || { time: "", foods: "" };
    const start = target.selectionStart ?? row.foods.length;
    const end = target.selectionEnd ?? start;
    const before = row.foods.slice(0, start);
    const after = row.foods.slice(end);
    const segmentStart = Math.max(before.lastIndexOf(","), before.lastIndexOf("，")) + 1;
    const segmentBeforeCursor = before.slice(segmentStart).trim();
    const tokens = segmentBeforeCursor.split(/\s+/).filter(Boolean);
    const lastToken = tokens.at(-1) || "";
    const hasFoodName = tokens.length >= 2;
    const segmentIndex = getMemoSegmentIndex(row.foods, start);

    const getCompletedUnitInput = () => {
      if (tokens.length >= 2) {
        const compact = parseQuantityUnitToken(lastToken);
        if (compact?.quantity > 0 && compact.unitText) {
          const name = cleanFoodName(tokens.slice(0, -1).join(""));
          if (name) return compact;
        }
      }

      if (tokens.length >= 3) {
        const separated = parseQuantityUnitTokens(tokens.at(-2), lastToken);
        if (separated?.quantity > 0 && separated.unitText) {
          const name = cleanFoodName(tokens.slice(0, -2).join(""));
          if (name) return separated;
        }
      }

      return null;
    };

    if (event.key === " ") {
      const completedUnitInput = start === end ? getCompletedUnitInput() : null;

      if (completedUnitInput) {
        event.preventDefault();
        const nextFoods = before + ", " + after;
        updateMemoRowField(rowIndex, "foods", nextFoods);
        setActiveMemoFoodCursor(start + 2);
        requestAnimationFrame(() => memoFoodRefs.current[rowIndex]?.setSelectionRange(start + 2, start + 2));
      } else if (start === end && hasFoodName && /^[0-9]+(?:\.[0-9]+)?$/.test(lastToken)) {
        event.preventDefault();
        const nextFoods = before + "g, " + after;
        updateMemoRowField(rowIndex, "foods", nextFoods);
        setActiveMemoFoodCursor(start + 3);
        requestAnimationFrame(() => memoFoodRefs.current[rowIndex]?.setSelectionRange(start + 3, start + 3));
      } else if (start === end && hasFoodName && /^[0-9]+(?:\.[0-9]+)?g$/i.test(lastToken)) {
        event.preventDefault();
        const nextFoods = before + ", " + after;
        updateMemoRowField(rowIndex, "foods", nextFoods);
        setActiveMemoFoodCursor(start + 2);
        requestAnimationFrame(() => memoFoodRefs.current[rowIndex]?.setSelectionRange(start + 2, start + 2));
      }
      return;
    }

    if (event.key !== "Enter") return;

    event.preventDefault();
    let nextFoods = row.foods;
    let cursorOffset = 0;

    if (start === end && hasFoodName && /^[0-9]+(?:\.[0-9]+)?$/.test(lastToken)) {
      nextFoods = before + "g" + after;
      cursorOffset = 1;
    }

    updateMemoRows((rows) => {
      const nextRows = [...rows];
      nextRows[rowIndex] = { ...nextRows[rowIndex], foods: nextFoods };
      nextRows.splice(rowIndex + 1, 0, { time: "", foods: "" });
      return nextRows;
    }, { field: "time", index: rowIndex + 1 });
    setActiveMemoRowIndex(rowIndex + 1);
    setActiveMemoFoodCursor(0);
    setMemoPreviewHidden(true);
  };

  const getMemoCursorContext = (start, end = start) => {
    const lineStart = memoInput.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
    const lineEndIndex = memoInput.indexOf("\n", start);
    const lineEnd = lineEndIndex === -1 ? memoInput.length : lineEndIndex;
    const beforeCursor = memoInput.slice(lineStart, start);
    const segmentStart = Math.max(beforeCursor.lastIndexOf(","), beforeCursor.lastIndexOf("，")) + 1;
    const tokenBefore = beforeCursor.slice(segmentStart).match(/\S+$/);
    const afterCursor = memoInput.slice(end, lineEnd);
    const tokenAfter = afterCursor.match(/^\S*/)?.[0] || "";
    const tokenStart = tokenBefore ? lineStart + segmentStart + tokenBefore.index : start;
    const tokenEnd = end + tokenAfter.length;

    return { tokenStart, tokenEnd };
  };

  const handleMemoInputChange = (event) => {
    const nextValue = event.target.value;
    const cursor = event.target.selectionStart ?? nextValue.length;
    const lineStart = nextValue.lastIndexOf("\n", Math.max(0, cursor - 1)) + 1;
    const beforeCursor = nextValue.slice(lineStart, cursor);

    setMemoPreviewHidden(false);

    if (/^\d{2}$/.test(beforeCursor) && Number(beforeCursor) <= 24) {
      setMemoValueWithCursor(nextValue.slice(0, cursor) + ":" + nextValue.slice(cursor), cursor + 1);
      return;
    }

    setMemoInput(nextValue);
    setMemoCursorIndex(cursor);
  };

  const saveMemoValue = (value, unitOverrides = memoUnitOverrides) => {
    if (dayComplete) return false;

    const parsed = parseDailyMemoInput(value, customFoods, memoFoodBasisMap, unitOverrides);
    if (parsed.unitTargets?.length > 0) {
      const target = parsed.unitTargets[0];
      setUnitAmountTarget(target);
      setUnitAmountInput("");
      setFormError("");
      requestAnimationFrame(() => unitAmountInputRef.current?.focus());
      return false;
    }
    if (parsed.errors.length > 0) {
      setFormError(parsed.errors[0]);
      return false;
    }

    const mergedMeals = mergeMealsWithSameTime(parsed.meals);
    const normalizedMemo = mergedMeals.map(mealToDailyMemoLine).join("\n");

    skipNextMemoSyncRef.current = true;
    setMeals(mergedMeals);
    setMemoInput(normalizedMemo);
    setMemoFoodBasisMap(buildMemoBasisMapFromMeals(mergedMeals));
    setMemoUnitOverrides(buildMemoUnitOverrideMapFromMeals(mergedMeals));
    setMemoCursorIndex(normalizedMemo.length);
    setFormError("");
    return true;
  };

  const handleMemoKeyDown = (event) => {
    const target = event.currentTarget;
    const start = target.selectionStart;
    const end = target.selectionEnd;
    const before = memoInput.slice(0, start);
    const after = memoInput.slice(end);
    const lineStart = before.lastIndexOf("\n") + 1;
    const beforeLine = before.slice(0, lineStart);
    const currentLine = before.slice(lineStart);

    if (event.key === "Backspace" && start === end && /^\d{1,2}:$/.test(currentLine)) {
      event.preventDefault();
      setMemoValueWithCursor(before.slice(0, -1) + after, start - 1);
      return;
    }

    if (/^\d$/.test(event.key) && start === end && /^\d$/.test(currentLine)) {
      const timeDraft = currentLine + event.key;
      if (Number(timeDraft) <= 24) {
        event.preventDefault();
        setMemoValueWithCursor(beforeLine + timeDraft + ":" + after, beforeLine.length + 3);
      }
      return;
    }

    if (event.key === " ") {
      const timeDraft = currentLine.trim();
      if (/^\d{1,2}:?\d{0,2}$/.test(timeDraft)) {
        const normalizedTime = parseTimeInput(timeDraft);
        if (normalizedTime) {
          event.preventDefault();
          const nextPrefix = normalizedTime + "\t";
          setMemoValueWithCursor(beforeLine + nextPrefix + after, beforeLine.length + nextPrefix.length);
          return;
        }
      }

      const segmentStart = Math.max(currentLine.lastIndexOf(","), currentLine.lastIndexOf("，")) + 1;
      const segmentBeforeCursor = currentLine.slice(segmentStart).trim();
      const tokens = segmentBeforeCursor.split(/\s+/).filter(Boolean);
      const lastToken = tokens.at(-1) || "";
      const hasFoodName = tokens.length >= 2;
      const compactUnit = tokens.length >= 2 ? parseQuantityUnitToken(lastToken) : null;
      const separatedUnit = tokens.length >= 3 ? parseQuantityUnitTokens(tokens.at(-2), lastToken) : null;
      const hasCompletedUnitInput = Boolean(
        (compactUnit?.quantity > 0 && compactUnit.unitText && cleanFoodName(tokens.slice(0, -1).join(""))) ||
        (separatedUnit?.quantity > 0 && separatedUnit.unitText && cleanFoodName(tokens.slice(0, -2).join("")))
      );

      if (start === end && hasCompletedUnitInput) {
        event.preventDefault();
        setMemoValueWithCursor(before + ", " + after, start + 2);
      } else if (start === end && hasFoodName && /^[0-9]+(?:\.[0-9]+)?$/.test(lastToken)) {
        event.preventDefault();
        setMemoValueWithCursor(before + "g, " + after, start + 3);
      } else if (start === end && hasFoodName && /^[0-9]+(?:\.[0-9]+)?g$/i.test(lastToken)) {
        event.preventDefault();
        setMemoValueWithCursor(before + ", " + after, start + 2);
      }
      return;
    }

    if (event.key !== "Enter") return;

    const segmentStart = Math.max(currentLine.lastIndexOf(","), currentLine.lastIndexOf("，")) + 1;
    const segmentBeforeCursor = currentLine.slice(segmentStart).trim();
    const tokens = segmentBeforeCursor.split(/\s+/).filter(Boolean);
    const lastToken = tokens.at(-1) || "";
    const hasFoodName = tokens.length >= 2;

    if (start === end && hasFoodName && /^[0-9]+(?:\.[0-9]+)?$/.test(lastToken)) {
      event.preventDefault();
      const nextValue = before + "g\n" + after;
      setMemoPreviewHidden(true);
      setFormError("");
      setMemoValueWithCursor(nextValue, start + 2);
      return;
    }

    if (start === end && hasFoodName && /^[0-9]+(?:\.[0-9]+)?g$/i.test(lastToken)) {
      event.preventDefault();
      const nextValue = before + "\n" + after;
      setMemoPreviewHidden(true);
      setFormError("");
      setMemoValueWithCursor(nextValue, start + 1);
      return;
    }

    const fullLineEnd = after.indexOf("\n") === -1 ? memoInput.length : start + after.indexOf("\n");
    const afterLine = memoInput.slice(start, fullLineEnd);
    const fullCurrentLine = currentLine + afterLine;
    const timeMatch = fullCurrentLine.match(/^(\d{1,2}(?::\d{0,2})?)\s+(.+)$/);

    if (timeMatch) {
      const normalizedTime = parseTimeInput(timeMatch[1]);
      if (normalizedTime) {
        event.preventDefault();
        const normalizedLine = normalizedTime + "\t" + timeMatch[2].trim();
        const nextValue = memoInput.slice(0, lineStart) + normalizedLine + "\n" + memoInput.slice(fullLineEnd);
        const nextCursor = lineStart + normalizedLine.length + 1;

        setMemoPreviewHidden(true);
        setFormError("");
        setMemoValueWithCursor(nextValue, nextCursor);
      }
    }
  };

  const saveMealFromMemo = (event) => {
    event.preventDefault();
    saveMemoValue(memoInput);
  };

  const toggleMeal = (mealId) => {
    setMeals((current) =>
      current.map((meal) => (meal.id === mealId ? { ...meal, isOpen: !meal.isOpen } : meal))
    );
  };

  const deleteMeal = (mealId) => {
    const meal = meals.find((item) => item.id === mealId);
    if (!meal) return;
    setActionTarget(null);

    if (window.confirm(meal.time + " 식단을 삭제할까?")) {
      setMeals((current) => current.filter((item) => item.id !== mealId));
    }
  };

  const deleteFood = (mealId, foodId) => {
    const meal = meals.find((item) => item.id === mealId);
    const food = meal?.items.find((item) => item.id === foodId);
    if (!food) return;
    setActionTarget(null);

    if (window.confirm(food.name + "을 삭제할까?")) {
      setMeals((current) =>
        current.map((item) =>
          item.id === mealId ? { ...item, items: item.items.filter((entry) => entry.id !== foodId) } : item
        )
      );
    }
  };

  const updateMatchingItems = (updater) => {
    setMeals((current) =>
      current.map((meal) => ({
        ...meal,
        items: meal.items.map((item) => updater(item)),
      }))
    );
  };

  const applyFoodBasisToMealItem = (mealId, itemId, food) => {
    setMeals((current) =>
      current.map((meal) =>
        meal.id === mealId
          ? {
              ...meal,
              items: meal.items.map((item) =>
                item.id === itemId ? applyFoodBasisToItem(item, food) : item
              ),
            }
          : meal
      )
    );
  };

  const saveAliasForFuture = async (aliasText, food) => {
    const aliasName = cleanFoodName(aliasText);
    if (!aliasName || !food) return customFoods;

    const canonicalName = getFoodDisplayName(food);
    const aliasFood = {
      ...food,
      id: "local-alias-" + normalize(aliasName),
      name: aliasName,
      canonicalName,
      source: "user_alias",
    };

    const canSaveRemoteAlias = Boolean(food.appFoodId || food.app_food_id || food.userFoodId || food.user_food_id);

    if (HAS_SUPABASE_CONFIG && authSession && canSaveRemoteAlias) {
      try {
        await upsertUserAlias(authSession, aliasName, food);
      } catch (error) {
        console.warn("별칭 저장 실패, 로컬 반영 유지:", error);
      }
    }

    setCustomFoods((current) => ({ ...current, [normalize(aliasName)]: aliasFood }));
    return aliasFood;
  };

  const ensurePersistentFoodBasis = async (food) => {
    if (!food) return null;
    if (food.appFoodId || food.app_food_id || food.userFoodId || food.user_food_id) return food;

    const shouldPersistAsUserFood = food.source === "external_food";
    if (!shouldPersistAsUserFood || !HAS_SUPABASE_CONFIG || !authSession) return food;

    try {
      const savedRow = await upsertUserFood(authSession, {
        ...food,
        base_amount_g: 100,
        base_amount: 100,
        base_unit: "g",
      });
      const storedFood = toFoodEntry(savedRow, food.id);
      setCustomFoods((current) => mergeManagedUserFood(current, null, storedFood));
      return storedFood;
    } catch (error) {
      console.warn("외부 음식 DB 저장 실패, 이번 항목 기준으로만 반영:", error);
      return food;
    }
  };

  const connectAliasToFood = async (aliasText, food, options = {}) => {
    const aliasName = cleanFoodName(aliasText);
    if (!aliasName || !food) return null;

    const canonicalName = getFoodDisplayName(food);
    const aliasFood = {
      ...food,
      id: "local-alias-" + normalize(aliasName),
      name: aliasName,
      canonicalName,
      source: "user_alias",
    };

    const canSaveRemoteAlias = Boolean(food.appFoodId || food.app_food_id || food.userFoodId || food.user_food_id);

    if (HAS_SUPABASE_CONFIG && authSession && canSaveRemoteAlias) {
      try {
        await upsertUserAlias(authSession, aliasName, food);
      } catch (error) {
        console.warn("별칭 저장 실패, 로컬 반영 유지:", error);
      }
    }

    // 앞으로 사용할 alias만 바꾼다.
    // 이미 기록된 같은 이름의 음식까지 다시 계산하면
    // 예: 06시 밥=백미밥 기록이 09시 밥=찹쌀밥 저장 후 같이 바뀌는 문제가 생긴다.
    // 기존 기록은 item.per100/matchedFoodName에 남아 있으므로 이번 항목 기준처럼 고정한다.
    setCustomFoods((current) => ({ ...current, [normalize(aliasName)]: aliasFood }));

    if (options.closeModal) closeNutritionModal();
    return aliasFood;
  };

  const getItemBasisFood = (item) => {
    if (!item?.per100) return null;

    const matchedFood = Object.values(customFoods || {}).find((food) =>
      food.id === item.foodId ||
      normalize(getFoodDisplayName(food)) === normalize(item.matchedFoodName || "")
    );

    if (matchedFood) {
      return {
        ...matchedFood,
        displayName: getFoodDisplayName(matchedFood),
        isCurrentBasis: true,
      };
    }

    return getFoodBasisSnapshotFromItem(item);
  };

  const openNutritionModal = (mealId, item) => {
    const currentFood = getItemBasisFood(item);
    setNutritionTarget({
      mealId,
      itemId: item.id,
      name: item.name,
      amount: item.amount,
      currentFood,
    });
    setNutritionExternalSearch({ ...EMPTY_EXTERNAL_SEARCH_STATE, query: cleanFoodName(item.name) });
    setNutritionForm({
      name: currentFood ? getFoodDisplayName(currentFood) : cleanFoodName(item.name),
      baseAmount: "100",
      kcal: currentFood ? String(Math.round(toNumber(currentFood.kcal))) : "",
      carb: currentFood ? formatMacro(toNumber(currentFood.carb)) : "",
      protein: currentFood ? formatMacro(toNumber(currentFood.protein)) : "",
      fat: currentFood ? formatMacro(toNumber(currentFood.fat)) : "",
    });
  };

  const closeNutritionModal = () => {
    setNutritionTarget(null);
    setMatchChoiceTarget((current) => current?.source === "nutrition" ? null : current);
    setNutritionExternalSearch(EMPTY_EXTERNAL_SEARCH_STATE);
    setNutritionForm({ name: "", baseAmount: "100", kcal: "", carb: "", protein: "", fat: "" });
  };

  const openFoodBasisModal = (mealId, foodId) => {
    const meal = meals.find((entry) => entry.id === mealId);
    const item = meal?.items.find((entry) => entry.id === foodId);
    if (!item) return;
    setActionTarget(null);
    openNutritionModal(mealId, item);
  };

  const saveNutrition = async (event) => {
    event.preventDefault();
    if (!nutritionTarget) return;

    const baseAmount = toNumber(nutritionForm.baseAmount) || 100;
    const per100Rate = baseAmount > 0 ? 100 / baseAmount : 1;
    const foodName = cleanFoodName(nutritionForm.name || nutritionTarget.name);
    const food = {
      id: "custom-" + normalize(foodName),
      name: foodName,
      kcal: toNumber(nutritionForm.kcal) * per100Rate,
      carb: toNumber(nutritionForm.carb) * per100Rate,
      protein: toNumber(nutritionForm.protein) * per100Rate,
      fat: toNumber(nutritionForm.fat) * per100Rate,
    };

    if (!food.name || baseAmount <= 0 || food.kcal <= 0) return;

    let storedFood = food;

    if (HAS_SUPABASE_CONFIG && authSession) {
      try {
        const savedRow = await upsertUserFood(authSession, {
          ...food,
          base_amount_g: 100,
        });
        storedFood = toFoodEntry(savedRow, food.id);
      } catch (error) {
        console.warn("개인 음식 DB 저장 실패, 로컬 반영 유지:", error);
      }
    }

    setCustomFoods((current) => mergeManagedUserFood(current, null, storedFood));
    applyFoodBasisToMealItem(nutritionTarget.mealId, nutritionTarget.itemId, storedFood);

    if (normalize(nutritionTarget.name) !== normalize(storedFood.name)) {
      await saveAliasForFuture(nutritionTarget.name, storedFood);
    }

    closeNutritionModal();
  };

  const openNewMyFoodModal = () => {
    setMyFoodEditTarget(null);
    setMyFoodError("");
    setMyFoodExternalSearch(EMPTY_EXTERNAL_SEARCH_STATE);
    setMyFoodForm({ name: "", baseAmount: "100", kcal: "", carb: "", protein: "", fat: "" });
    setMyFoodModalOpen(true);
  };

  const openEditMyFoodModal = (food) => {
    setMyFoodEditTarget(food || null);
    setMyFoodError("");
    setMyFoodExternalSearch(EMPTY_EXTERNAL_SEARCH_STATE);
    setMyFoodForm(makeUserFoodFormFromFood(food));
    setMyFoodModalOpen(true);
  };

  const closeMyFoodModal = () => {
    setMyFoodEditTarget(null);
    setMyFoodModalOpen(false);
    setMyFoodError("");
    setMyFoodExternalSearch(EMPTY_EXTERNAL_SEARCH_STATE);
    setMyFoodForm({ name: "", baseAmount: "100", kcal: "", carb: "", protein: "", fat: "" });
  };

  const saveMyFood = async (event) => {
    event.preventDefault();
    setMyFoodError("");

    const preparedFood = getPreparedUserFoodFromForm(myFoodForm);
    const baseAmount = toNumber(myFoodForm.baseAmount) || 100;

    if (!preparedFood.name) {
      setMyFoodError("음식명을 입력해줘.");
      return;
    }

    if (baseAmount <= 0) {
      setMyFoodError("기준량은 1g 이상이어야 해.");
      return;
    }

    if (preparedFood.kcal <= 0) {
      setMyFoodError("kcal를 입력해야 저장할 수 있어.");
      return;
    }

    let storedFood = preparedFood;

    if (HAS_SUPABASE_CONFIG && authSession) {
      try {
        const savedRow = myFoodEditTarget?.userFoodId
          ? await updateUserFood(authSession, myFoodEditTarget.userFoodId, preparedFood)
          : await upsertUserFood(authSession, preparedFood);
        storedFood = toFoodEntry(savedRow, preparedFood.id);
      } catch (error) {
        setMyFoodError(error.message || "개인 음식 저장에 실패했어.");
        return;
      }
    }

    setCustomFoods((current) => mergeManagedUserFood(current, myFoodEditTarget, storedFood));

    // 현재 날짜 기록 중 이 개인 음식으로 계산된 항목은 새 영양값으로만 갱신한다.
    // 음식명/표시 단위는 사용자가 입력한 그대로 유지한다.
    setMeals((currentMeals) =>
      currentMeals.map((meal) => ({
        ...meal,
        items: meal.items.map((item) => {
          const sameFoodId = myFoodEditTarget?.id && item.foodId === myFoodEditTarget.id;
          const sameMatchedName = myFoodEditTarget?.name && normalize(item.matchedFoodName) === normalize(myFoodEditTarget.name);
          const sameInputName = myFoodEditTarget?.name && normalize(item.name) === normalize(myFoodEditTarget.name);
          return sameFoodId || sameMatchedName || sameInputName ? applyFoodBasisToItem(item, storedFood) : item;
        }),
      }))
    );

    closeMyFoodModal();
  };

  const removeMyFood = async (food) => {
    if (!food) return;
    if (!window.confirm(getFoodDisplayName(food) + "을 나의 음식에서 삭제할까?")) return;

    if (HAS_SUPABASE_CONFIG && authSession && food.userFoodId) {
      try {
        await deleteUserFood(authSession, food);
      } catch (error) {
        setFoodDbError(error.message || "개인 음식 삭제에 실패했어.");
        return;
      }
    }

    setCustomFoods((current) => removeManagedUserFoodFromMap(current, food));
  };

  const removeMyAlias = async (alias) => {
    if (!alias) return;
    const aliasName = cleanFoodName(alias.aliasText || alias.name || "");
    if (!window.confirm(aliasName + " 음식 연결을 삭제할까?")) return;

    if (HAS_SUPABASE_CONFIG && authSession) {
      try {
        await deleteUserAlias(authSession, alias);
      } catch (error) {
        setFoodDbError(error.message || "음식 연결 삭제에 실패했어.");
        return;
      }
    }

    setCustomFoods((current) => removeManagedAliasFromMap(current, alias));
  };


  const openEditMyUnitModal = (unit) => {
    setMyUnitEditTarget(unit || null);
    setMyUnitError("");
    setMyUnitForm({
      unitName: cleanFoodName(unit?.unitName || ""),
      grams: unit?.grams ? formatAmount(toNumber(unit.grams)) : "",
    });
    setMyUnitModalOpen(true);
  };

  const closeMyUnitModal = () => {
    setMyUnitEditTarget(null);
    setMyUnitModalOpen(false);
    setMyUnitError("");
    setMyUnitForm({ unitName: "", grams: "" });
  };

  const saveMyUnit = async (event) => {
    event.preventDefault();
    setMyUnitError("");

    if (!myUnitEditTarget) return;
    if (!cleanFoodName(myUnitForm.unitName)) {
      setMyUnitError("단위명을 입력해줘.");
      return;
    }
    if (toNumber(myUnitForm.grams) <= 0) {
      setMyUnitError("1단위당 g을 입력해줘.");
      return;
    }

    let savedUnit = {
      ...myUnitEditTarget,
      unit_name: cleanFoodName(myUnitForm.unitName),
      unitName: cleanFoodName(myUnitForm.unitName),
      grams: toNumber(myUnitForm.grams),
    };

    if (HAS_SUPABASE_CONFIG && authSession && myUnitEditTarget.userUnitId) {
      try {
        savedUnit = await updateUserFoodUnit(authSession, myUnitEditTarget, myUnitForm);
      } catch (error) {
        setMyUnitError(error.message || "단위 수정에 실패했어.");
        return;
      }
    }

    setCustomFoods((current) => {
      const removed = removeUserFoodUnitFromMap(current, myUnitEditTarget);
      return mergeUserFoodUnitIntoMap(removed, myUnitEditTarget.targetFood, savedUnit);
    });
    closeMyUnitModal();
  };

  const removeMyUnit = async (unit) => {
    if (!unit) return;
    const unitName = cleanFoodName(unit.unitName || "");
    const foodName = cleanFoodName(unit.foodName || getFoodDisplayName(unit.targetFood));
    if (!window.confirm(foodName + " " + unitName + " 단위 설정을 삭제할까?")) return;

    if (HAS_SUPABASE_CONFIG && authSession && unit.userUnitId) {
      try {
        await deleteUserFoodUnit(authSession, unit);
      } catch (error) {
        setFoodDbError(error.message || "단위 설정 삭제에 실패했어.");
        return;
      }
    }

    setCustomFoods((current) => removeUserFoodUnitFromMap(current, unit));
  };

  const openMemoMatchChoice = (food) => {
    if (!activeMemoPreviewName || !food) return;
    const segmentIndex = getMemoSegmentIndex(activeMemoRow.foods, activeFoodCursor);
    setMatchChoiceTarget({
      source: "memo",
      rowIndex: activeMemoRowIndex,
      segmentIndex,
      entryIndex: 0,
      aliasName: activeMemoPreviewName,
      food,
    });
  };

  const openNutritionMatchChoice = (food) => {
    if (!nutritionTarget || !food) return;
    setMatchChoiceTarget({
      source: "nutrition",
      mealId: nutritionTarget.mealId,
      itemId: nutritionTarget.itemId,
      aliasName: nutritionTarget.name,
      food,
    });
  };

  const closeMatchChoice = () => {
    setMatchChoiceTarget(null);
  };

  const applyMatchOnce = () => {
    if (!matchChoiceTarget) return;
    const targetFood = matchChoiceTarget.food;

    if (matchChoiceTarget.source === "memo") {
      const key = getMemoBasisKey(matchChoiceTarget.rowIndex, matchChoiceTarget.segmentIndex, matchChoiceTarget.entryIndex || 0);
      setMemoFoodBasisMap((current) => ({
        ...current,
        [key]: {
          aliasName: matchChoiceTarget.aliasName,
          food: targetFood,
        },
      }));
      setMemoPreviewHidden(true);
    }

    if (matchChoiceTarget.source === "nutrition") {
      applyFoodBasisToMealItem(matchChoiceTarget.mealId, matchChoiceTarget.itemId, targetFood);
      closeNutritionModal();
    }

    closeMatchChoice();
  };

  const applyMatchForever = async () => {
    if (!matchChoiceTarget) return;

    const targetFood = await ensurePersistentFoodBasis(matchChoiceTarget.food);
    await saveAliasForFuture(matchChoiceTarget.aliasName, targetFood);

    if (matchChoiceTarget.source === "memo") {
      const key = getMemoBasisKey(matchChoiceTarget.rowIndex, matchChoiceTarget.segmentIndex, matchChoiceTarget.entryIndex || 0);
      setMemoFoodBasisMap((current) => ({
        ...current,
        [key]: {
          aliasName: matchChoiceTarget.aliasName,
          food: targetFood,
        },
      }));
      setMemoPreviewHidden(true);
    }

    if (matchChoiceTarget.source === "nutrition") {
      applyFoodBasisToMealItem(matchChoiceTarget.mealId, matchChoiceTarget.itemId, targetFood);
      closeNutritionModal();
    }

    closeMatchChoice();
  };

  const closeUnitAmountModal = () => {
    setUnitAmountTarget(null);
    setUnitAmountInput("");
  };

  const saveUnitAmount = async (event) => {
    event.preventDefault();
    if (!unitAmountTarget?.key) return;
    const nextUnitGrams = toNumber(unitAmountInput);
    if (nextUnitGrams <= 0) return;

    const targetFood = unitAmountTarget.food || findFoodByName(unitAmountTarget.foodName, customFoods);

    if (targetFood && HAS_SUPABASE_CONFIG && authSession) {
      try {
        const savedUnit = await upsertUserFoodUnit(authSession, targetFood, unitAmountTarget.unitName, nextUnitGrams);
        setCustomFoods((current) => mergeUserFoodUnitIntoMap(current, targetFood, savedUnit));
      } catch (error) {
        console.warn("개인 단위 저장 실패, 이번 메모에만 반영:", error);
      }
    }

    const nextOverrides = {
      ...memoUnitOverrides,
      [unitAmountTarget.key]: nextUnitGrams,
    };

    setMemoUnitOverrides(nextOverrides);
    closeUnitAmountModal();
    saveMemoValue(memoInput, nextOverrides);
  };

  const openAmountModal = (mealId, item) => {
    setAmountTarget({ mealId, itemId: item.id, name: item.name });
    setAmountInput(item.amount > 0 ? String(item.amount) : "");
    requestAnimationFrame(() => amountInputRef.current?.focus());
  };

  const closeAmountModal = () => {
    setAmountTarget(null);
    setAmountInput("");
  };

  const saveAmount = (event) => {
    event.preventDefault();
    if (!amountTarget) return;
    const nextAmount = toNumber(amountInput);
    if (nextAmount <= 0) return;

    setMeals((current) =>
      current.map((meal) =>
        meal.id === amountTarget.mealId
          ? {
              ...meal,
              items: meal.items.map((item) =>
                item.id === amountTarget.itemId
                  ? resolveItem(
                      {
                        ...item,
                        amount: nextAmount,
                        rawLine: item.name + " " + nextAmount + "g",
                        displayAmount: null,
                        displayUnit: "",
                      },
                      customFoods
                    )
                  : item
              ),
            }
          : meal
      )
    );
    closeAmountModal();
  };

  const startEditFood = (mealId, itemId) => {
    const meal = meals.find((entry) => entry.id === mealId);
    const item = meal?.items.find((entry) => entry.id === itemId);
    if (!item) return;
    setActionTarget(null);
    setFoodEditTarget({ mealId, itemId });
    setFoodEditForm({ name: item.name, amount: item.amount > 0 ? String(item.amount) : "" });
  };

  const closeFoodEditModal = () => {
    setFoodEditTarget(null);
    setFoodEditForm({ name: "", amount: "" });
  };

  const saveFoodEdit = (event) => {
    event.preventDefault();
    if (!foodEditTarget) return;
    const nextName = cleanFoodName(foodEditForm.name);
    if (!nextName) return;
    const nextAmount = toNumber(foodEditForm.amount);

    setMeals((current) =>
      current.map((meal) =>
        meal.id === foodEditTarget.mealId
          ? {
              ...meal,
              items: meal.items.map((item) =>
                item.id === foodEditTarget.itemId
                  ? createItem(
                      nextName,
                      nextAmount,
                      customFoods,
                      nextName + (nextAmount > 0 ? " " + nextAmount + "g" : ""),
                      item.id
                    )
                  : item
              ),
            }
          : meal
      )
    );
    closeFoodEditModal();
  };

  const handleFoodNameEditKeyDown = (event) => {
    if (event.key === " ") {
      event.preventDefault();
      foodEditAmountRef.current?.focus();
    }
  };

  const runExternalFoodSearch = async (query, setState) => {
    const keyword = String(query || "").trim();
    if (!keyword) {
      setState((current) => ({ ...current, error: "검색어를 입력해줘.", searched: true, results: [] }));
      return;
    }

    setState((current) => ({ ...current, query: keyword, loading: true, error: "", searched: true }));

    try {
      const results = await searchExternalFoods(keyword);
      setState((current) => ({ ...current, loading: false, results, error: "", searched: true }));
    } catch (error) {
      setState((current) => ({
        ...current,
        loading: false,
        results: [],
        error: error?.message || "음식 DB 조회에 실패했습니다. 직접 등록해줘.",
        searched: true,
      }));
    }
  };

  const searchNutritionExternalCandidates = () => {
    runExternalFoodSearch(nutritionExternalSearch.query || nutritionTarget?.name || "", setNutritionExternalSearch);
  };

  const searchMyFoodExternalCandidates = () => {
    runExternalFoodSearch(myFoodExternalSearch.query || myFoodForm.name || "", setMyFoodExternalSearch);
  };

  const handleNutritionExternalSearchKeyDown = (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    searchNutritionExternalCandidates();
  };

  const handleMyFoodExternalSearchKeyDown = (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    searchMyFoodExternalCandidates();
  };

  const openNutritionExternalMatchChoice = (food) => {
    if (!nutritionTarget || !food) return;
    setNutritionForm(makeMyFoodFormFromExternalFood(food));
  };

  const applyExternalFoodToMyFoodForm = (food) => {
    if (!food) return;
    setMyFoodForm(makeMyFoodFormFromExternalFood(food));
  };

  const nutritionCandidateFoods = useMemo(() => {
    if (!nutritionTarget) return [];

    const matches = findFoodMatchesExpanded(nutritionTarget.name, customFoods);
    const currentFood = nutritionTarget.currentFood
      ? {
          ...nutritionTarget.currentFood,
          matchScore: -1,
          matchWeight: 999,
          isCurrentBasis: true,
          displayName: getFoodDisplayName(nutritionTarget.currentFood),
        }
      : null;

    return currentFood ? dedupeFoodMatches([currentFood, ...matches]) : matches;
  }, [nutritionTarget, customFoods]);

  if (authChecking) {
    return (
      <div className="login-shell">
        <div className="login-card">
          <span className="login-kicker">Diet Memo</span>
          <h1>로그인 상태 확인 중</h1>
          <p>저장된 로그인 정보로 자동 로그인하고 있어.</p>
        </div>
      </div>
    );
  }

  if (!authSession) {
    return (
      <LoginScreen
        mode={authMode}
        form={authForm}
        error={authError}
        message={authMessage}
        loading={authLoading}
        hasConfig={HAS_SUPABASE_CONFIG}
        onModeChange={(mode) => {
          setAuthMode(mode);
          setAuthError("");
          setAuthMessage("");
        }}
        onFormChange={(field, value) => setAuthForm((current) => ({ ...current, [field]: value }))}
        onSubmit={submitAuth}
      />
    );
  }

  if (setupScreen === "setup") {
    return (
      <SetupScreen
        profile={profile}
        onProfileChange={updateProfileField}
        onSubmit={calculateProfile}
      />
    );
  }

  if (setupScreen === "result") {
    return (
      <PlanResultScreen
        plan={activePlan}
        onPlanChange={updatePlanTargets}
        onBack={() => setSetupScreen("setup")}
        onStart={() => setSetupScreen("diary")}
      />
    );
  }

  return (
    <main
      className={recordSwipeClassName}
      style={recordSwipeStyle}
      onPointerDown={handleRecordSwipePointerDown}
      onPointerMove={handleRecordSwipePointerMove}
      onPointerUp={handleRecordSwipePointerEnd}
      onPointerCancel={resetRecordSwipe}
    >
      {activeTab !== "foods" && (activeTab !== "record" || recordView === "diet") && (
        <section className="top-panel" aria-label="오늘 식단 요약">
        <div className="date-row date-nav-row compact-date-row">
          <button className="calendar-open-button" type="button" onClick={() => setCalendarOpen(true)} aria-label="달력 열기">
            📅
          </button>
          <p className="date-label">{today}</p>
          <div className="top-actions">
            <button className="icon-button" type="button" onClick={() => setSettingsOpen(true)} aria-label="설정 열기">
              ⚙
            </button>
          </div>
        </div>
        {!isViewingToday && <p className="date-helper-text">선택한 날짜의 기록을 확인 중이야.</p>}
        {activeTab === "record" && (
          <RecordViewSwitch value={recordView} onChange={setRecordView} />
        )}
        {foodDbLoading && <p className="date-helper-text">음식 DB 불러오는 중...</p>}
        {foodDbError && <p className="form-error">{foodDbError}</p>}

        <div className="summary-grid">
          <SummaryItem label="목표" value={calorieGoal + " kcal"} />
          <SummaryItem label="섭취" value={Math.round(totals.kcal) + " kcal"} />
          <SummaryItem label="남은" value={Math.round(remainingCalories) + " kcal"} highlight={remainingCalories >= 0} />
        </div>

        <div className="calorie-section">
          <div
            className="calorie-ring"
            style={{ "--progress": caloriePercent + "%", "--graph-color": calorieGraphColor }}
          >
            <span>{Math.round(totals.kcal)}</span>
            <small>/{calorieGoal}</small>
          </div>

          <div className="macro-list">
            <MacroBar label="탄수화물" macro="carb" value={totals.carb} target={macroTargets.carb} profile={activePlan.profile} />
            <MacroBar label="단백질" macro="protein" value={totals.protein} target={macroTargets.protein} profile={activePlan.profile} />
            <MacroBar label="지방" macro="fat" value={totals.fat} target={macroTargets.fat} profile={activePlan.profile} />
          </div>
        </div>
        </section>
      )}

      {activeTab === "record" && recordView === "workout" && (
        <section className="workout-top-panel" aria-label="오늘 운동 기록">
          <div className="date-row date-nav-row compact-date-row">
            <button className="calendar-open-button" type="button" onClick={() => setCalendarOpen(true)} aria-label="달력 열기">
              📅
            </button>
            <p className="date-label">{today}</p>
            <div className="top-actions">
              <button className="icon-button" type="button" onClick={() => setSettingsOpen(true)} aria-label="설정 열기">
                ⚙
              </button>
            </div>
          </div>
          {!isViewingToday && <p className="date-helper-text">선택한 날짜의 운동 기록을 확인 중이야.</p>}
          <RecordViewSwitch value={recordView} onChange={setRecordView} />
        </section>
      )}

      {activeTab === "record" && recordView === "diet" && (
        <>
      <MorningWeightCard
        value={morningWeight}
        inputValue={morningWeightInput}
        onInputChange={setMorningWeightInput}
        onRegister={registerMorningWeight}
        onLongPress={() => morningWeight && setActionTarget({ type: "weight" })}
      />

      <section className="daily-memo-card" aria-label="식단 메모 입력" ref={dailyMemoCardRef}>
        <div className="section-title">
          <strong>식단 메모</strong>
        </div>
        <form className="daily-memo-form" onSubmit={saveMealFromMemo}>
          <div className="daily-memo-editor" ref={memoInputRef} aria-label="식단 메모 입력창">
            {visibleMemoRows.map((row, index) => (
              <div className="daily-memo-row" key={index}>
                <input
                  ref={(element) => { memoTimeRefs.current[index] = element; }}
                  className="memo-time-input"
                  value={row.time}
                  onChange={(event) => handleMemoRowTimeChange(index, event)}
                  onKeyDown={(event) => handleMemoRowTimeKeyDown(index, event)}
                  onFocus={() => {
                    setActiveMemoRowIndex(index);
                    setMemoPreviewHidden(true);
                  }}
                  inputMode="numeric"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  disabled={dayComplete}
                  placeholder={shouldShowMemoExamples ? (MEMO_EXAMPLE_ROWS[index]?.time || "") : ""}
                  aria-label={`${index + 1}번째 식사 시각`}
                />
                <textarea
                  ref={(element) => { memoFoodRefs.current[index] = element; }}
                  className="memo-food-input"
                  value={row.foods}
                  rows={Math.max(1, Math.ceil((row.foods || "").length / 20))}
                  onChange={(event) => handleMemoRowFoodChange(index, event)}
                  onKeyDown={(event) => handleMemoRowFoodKeyDown(index, event)}
                  onFocus={(event) => updateActiveMemoFoodCursor(index, event.currentTarget)}
                  onClick={(event) => updateActiveMemoFoodCursor(index, event.currentTarget)}
                  onKeyUp={(event) => updateActiveMemoFoodCursor(index, event.currentTarget)}
                  onSelect={(event) => updateActiveMemoFoodCursor(index, event.currentTarget)}
                  lang="ko-KR"
                  inputMode="text"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="enter"
                  disabled={dayComplete}
                  placeholder={shouldShowMemoExamples ? (MEMO_EXAMPLE_ROWS[index]?.foods || "") : ""}
                  aria-label={`${index + 1}번째 식사 음식`}
                />
              </div>
            ))}
          </div>

          {showMemoDbPreview && !dayComplete && (
            <div className="memo-db-preview" aria-label="음식 DB 검색 결과">
              {memoPreviewFoods.length > 0 ? (
                memoPreviewFoods.map((food) => {
                  const isSavedAlias = isSavedAliasPreviewFood(food);
                  const displayName = food.displayName || getFoodDisplayName(food);
                  const nameParts = splitMemoPreviewFoodName(displayName);

                  return (
                    <button
                      key={food.id}
                      type="button"
                      className={"memo-preview-row" + (isSavedAlias ? " is-saved-alias-basis" : "")}
                      onClick={() => openMemoMatchChoice(food)}
                    >
                      <div className="memo-preview-name">
                        <strong>{nameParts.main}</strong>
                        {nameParts.sub && <small>{nameParts.sub}</small>}
                      </div>

                      <div className="memo-preview-nutrients">
                        <span>100g {formatAmount(toNumber(food.kcal))}kcal</span>
                        <span>
                          C {formatMacro(food.carb)}g · P {formatMacro(food.protein)}g · F {formatMacro(food.fat)}g
                        </span>
                      </div>
                    </button>
                  );
                })
              ) : (
                <p>DB에 없는 음식</p>
              )}
            </div>
          )}

          {formError && <p className="form-error">{formError}</p>}

          <div className="daily-memo-actions">
            <button
              type="button"
              className="ghost-button"
              onClick={() => {
                if (window.confirm("현재 메모를 비울까요?")) {
                  setMemoInput("");
                  setMemoFoodBasisMap({});
                  setMemoUnitOverrides({});
                  setMeals([]);
                }
              }}
              disabled={dayComplete || !memoInput.trim()}
            >
              비우기
            </button>
            <button type="submit" className="primary-button" disabled={dayComplete}>
              저장하고 분석
            </button>
          </div>
        </form>
      </section>

      <section className="meal-list" aria-label="시간별 식단">
        {sortedMeals.length === 0 ? (
          <div className="empty-state">
            <strong>아직 기록이 없어.</strong>
            <span>메모장에 식단을 적으면 자동으로 정리돼.</span>
          </div>
        ) : (
          sortedMeals.map((meal) => (
            <MealCard
              key={meal.id}
              meal={meal}
              onToggle={() => toggleMeal(meal.id)}
              onEditMeal={() => startEditMeal(meal.id)}
              onLongPress={() => setActionTarget({ type: "meal", mealId: meal.id })}
              onFoodLongPress={(foodId) => setActionTarget({ type: "food", mealId: meal.id, foodId })}
              onOpenAmount={openAmountModal}
              onOpenNutrition={openNutritionModal}
            />
          ))
        )}
      </section>
        </>
      )}

      {activeTab === "record" && recordView === "workout" && (
        <WorkoutScreen
          selectedDateKey={selectedDateKey}
          savedEntries={workoutEntries}
          dailyRecords={dailyRecords}
          profile={profile}
          onSave={saveWorkoutEntries}
          onExerciseSettingChange={updateExerciseSetting}
        />
      )}

      {activeTab === "stats" && (
        <StatsScreen stats={stats} plan={activePlan} totals={totals} />
      )}

      {activeTab === "foods" && (
        <MyFoodsScreen
          foods={managedUserFoods}
          aliases={managedUserAliases}
          units={managedUserUnits}
          onAdd={openNewMyFoodModal}
          onEdit={openEditMyFoodModal}
          onDelete={removeMyFood}
          onDeleteAlias={removeMyAlias}
          onEditUnit={openEditMyUnitModal}
          onDeleteUnit={removeMyUnit}
        />
      )}

      <div className="app-footer-actions">
        {activeTab === "record" && recordView === "diet" && (
          <button
            className={dayComplete ? "finish-day-button is-complete" : "finish-day-button"}
            type="button"
            onClick={completeDay}
            {...(dayComplete ? finishDayLongPressProps : {})}
          >
            {dayComplete ? "오늘 식단 완성됨" : "오늘 하루 식단 완성"}
          </button>
        )}
        <BottomNav activeTab={activeTab} onChange={setActiveTab} />
      </div>

      {myFoodModalOpen && (
        <Modal title={myFoodEditTarget ? "나의 음식 수정" : "나의 음식 추가"} onClose={closeMyFoodModal}>
          <form className="modal-form" onSubmit={saveMyFood}>
            {!myFoodEditTarget && (
              <div className="public-food-search-panel">
                <label>
                  <span>음식 DB 검색</span>
                  <div className="public-food-search-row">
                    <input
                      value={myFoodExternalSearch.query}
                      onChange={(event) => setMyFoodExternalSearch((current) => ({ ...current, query: event.target.value }))}
                      onKeyDown={handleMyFoodExternalSearchKeyDown}
                      placeholder="예: 짜파게티"
                      lang="ko-KR"
                      autoCapitalize="off"
                    />
                    <button type="button" className="ghost-button" onClick={searchMyFoodExternalCandidates} disabled={myFoodExternalSearch.loading}>
                      {myFoodExternalSearch.loading ? "검색 중" : "검색"}
                    </button>
                  </div>
                </label>
                {myFoodExternalSearch.error && <p className="public-food-status is-error">{myFoodExternalSearch.error}</p>}
                {myFoodExternalSearch.loading && <p className="public-food-status">검색 중...</p>}
                {!myFoodExternalSearch.loading && myFoodExternalSearch.searched && !myFoodExternalSearch.error && myFoodExternalSearch.results.length === 0 && (
                  <p className="public-food-status">검색 결과가 없습니다.</p>
                )}
                {myFoodExternalSearch.results.length > 0 && (
                  <div className="alias-candidate-list public-food-candidate-list">
                    {myFoodExternalSearch.results.map((food) => {
                      const basisFood = makeExternalFoodBasis(food);
                      return (
                        <button key={food.id || food.sourceFoodCode || food.name} type="button" onClick={() => applyExternalFoodToMyFoodForm(food)}>
                          <strong>{basisFood.name}</strong>
                          <em>100g</em>
                          <span>
                            <b>{Math.round(basisFood.kcal)}kcal</b>
                            <small>C {formatMacro(basisFood.carb)}g P {formatMacro(basisFood.protein)}g F {formatMacro(basisFood.fat)}g</small>
                            {getExternalFoodMetaText(food) && <small>{getExternalFoodMetaText(food)}</small>}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            <label>
              <span>음식명</span>
              <input
                value={myFoodForm.name}
                onChange={(event) => setMyFoodForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="예: 제육"
                lang="ko-KR"
                autoCapitalize="off"
              />
            </label>
            <div className="nutrition-manual-row nutrition-manual-row-two">
              <label>
                <span>기준 중량(g)</span>
                <input
                  value={myFoodForm.baseAmount}
                  onChange={(event) => setMyFoodForm((current) => ({ ...current, baseAmount: event.target.value }))}
                  inputMode="numeric"
                  min="1"
                  step="1"
                  placeholder="예: 100"
                />
              </label>
              <label>
                <span>kcal</span>
                <input
                  value={myFoodForm.kcal}
                  onChange={(event) => setMyFoodForm((current) => ({ ...current, kcal: event.target.value }))}
                  inputMode="numeric"
                  min="0"
                  step="1"
                />
              </label>
            </div>
            <div className="nutrition-manual-row nutrition-manual-row-three">
              <label>
                <span>Carb</span>
                <input
                  value={myFoodForm.carb}
                  onChange={(event) => setMyFoodForm((current) => ({ ...current, carb: event.target.value }))}
                  inputMode="decimal"
                  min="0"
                  step="0.1"
                />
              </label>
              <label>
                <span>Pro</span>
                <input
                  value={myFoodForm.protein}
                  onChange={(event) => setMyFoodForm((current) => ({ ...current, protein: event.target.value }))}
                  inputMode="decimal"
                  min="0"
                  step="0.1"
                />
              </label>
              <label>
                <span>Fat</span>
                <input
                  value={myFoodForm.fat}
                  onChange={(event) => setMyFoodForm((current) => ({ ...current, fat: event.target.value }))}
                  inputMode="decimal"
                  min="0"
                  step="0.1"
                />
              </label>
            </div>
            {myFoodError && <p className="form-error">{myFoodError}</p>}
            <ModalActions onCancel={closeMyFoodModal} submitText={myFoodEditTarget ? "수정" : "추가"} />
          </form>
        </Modal>
      )}


      {myUnitModalOpen && (
        <Modal title="단위 설정 수정" onClose={closeMyUnitModal}>
          <form className="modal-form" onSubmit={saveMyUnit}>
            <label>
              <span>음식</span>
              <input
                value={cleanFoodName(myUnitEditTarget?.foodName || getFoodDisplayName(myUnitEditTarget?.targetFood))}
                readOnly
              />
            </label>
            <div className="nutrition-manual-row nutrition-manual-row-two">
              <label>
                <span>단위명</span>
                <input
                  value={myUnitForm.unitName}
                  onChange={(event) => setMyUnitForm((current) => ({ ...current, unitName: event.target.value }))}
                  placeholder="예: 개, 인분, 공기"
                  lang="ko-KR"
                  autoCapitalize="off"
                />
              </label>
              <label>
                <span>1단위(g)</span>
                <input
                  value={myUnitForm.grams}
                  onChange={(event) => setMyUnitForm((current) => ({ ...current, grams: event.target.value }))}
                  inputMode="decimal"
                  min="1"
                  step="1"
                  placeholder="예: 120"
                />
              </label>
            </div>
            {myUnitError && <p className="form-error">{myUnitError}</p>}
            <ModalActions onCancel={closeMyUnitModal} submitText="수정" />
          </form>
        </Modal>
      )}

      {unitAmountTarget && (
        <Modal title={unitAmountTarget.foodName + " " + unitAmountTarget.unitName + " 중량 등록"} onClose={closeUnitAmountModal}>
          <form className="modal-form" onSubmit={saveUnitAmount}>
            <label>
              <span>1{unitAmountTarget.unitName}에 해당하는 중량(g)</span>
              <input
                ref={unitAmountInputRef}
                value={unitAmountInput}
                onChange={(event) => setUnitAmountInput(event.target.value)}
                inputMode="decimal"
                step="1"
                min="0"
                placeholder="예: 100"
              />
            </label>
            {unitAmountTarget.quantity > 1 && (
              <p className="modal-hint">
                이번 입력은 {formatAmount(unitAmountTarget.quantity)}{unitAmountTarget.unitName}라서 입력한 중량의 {formatAmount(unitAmountTarget.quantity)}배로 계산돼.
              </p>
            )}
            <ModalActions onCancel={closeUnitAmountModal} submitText="등록" />
          </form>
        </Modal>
      )}

      {amountTarget && (
        <Modal title={amountTarget.name + " 중량 등록"} onClose={closeAmountModal}>
          <form className="modal-form" onSubmit={saveAmount}>
            <label>
              <span>섭취량(g)</span>
              <input
                ref={amountInputRef}
                value={amountInput}
                onChange={(event) => setAmountInput(event.target.value)}
                inputMode="decimal"
                step="10"
                min="0"
                placeholder="예: 230"
              />
            </label>
            <ModalActions onCancel={closeAmountModal} submitText="등록" />
          </form>
        </Modal>
      )}

      {nutritionTarget && (
        <Modal title="음식 연결/등록" onClose={closeNutritionModal}>
          <form className="modal-form" onSubmit={saveNutrition}>
            <div className="public-food-search-panel">
              <label>
                <span>음식 DB 검색</span>
                <div className="public-food-search-row">
                  <input
                    value={nutritionExternalSearch.query}
                    onChange={(event) => setNutritionExternalSearch((current) => ({ ...current, query: event.target.value }))}
                    onKeyDown={handleNutritionExternalSearchKeyDown}
                    placeholder="예: 짜파게티"
                    lang="ko-KR"
                    autoCapitalize="off"
                  />
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={searchNutritionExternalCandidates}
                    disabled={nutritionExternalSearch.loading}
                  >
                    {nutritionExternalSearch.loading ? "검색 중" : "검색"}
                  </button>
                </div>
              </label>
              {nutritionExternalSearch.error && <p className="public-food-status is-error">{nutritionExternalSearch.error}</p>}
              {nutritionExternalSearch.loading && <p className="public-food-status">검색 중...</p>}
              {!nutritionExternalSearch.loading && nutritionExternalSearch.searched && !nutritionExternalSearch.error && nutritionExternalSearch.results.length === 0 && (
                <p className="public-food-status">검색 결과가 없습니다.</p>
              )}
              {nutritionExternalSearch.results.length > 0 && (
                <div className="alias-candidate-list public-food-candidate-list">
                  {nutritionExternalSearch.results.map((food) => {
                    const basisFood = makeExternalFoodBasis(food, nutritionTarget.name);
                    return (
                      <button key={food.id || food.sourceFoodCode || food.name} type="button" onClick={() => openNutritionExternalMatchChoice(food)}>
                        <strong>{basisFood.name}</strong>
                        <em>100g</em>
                        <span>
                          <b>{Math.round(basisFood.kcal)}kcal</b>
                          <small>C {formatMacro(basisFood.carb)}g P {formatMacro(basisFood.protein)}g F {formatMacro(basisFood.fat)}g</small>
                          {getExternalFoodMetaText(food) && <small>{getExternalFoodMetaText(food)}</small>}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <label>
              <span>음식명</span>
              <input
                value={nutritionForm.name}
                onChange={(event) => setNutritionForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="예: 제육"
                lang="ko-KR"
                autoCapitalize="off"
              />
            </label>
            <div className="nutrition-manual-row nutrition-manual-row-two">
              <label>
                <span>기준 중량(g)</span>
                <input
                  value={nutritionForm.baseAmount}
                  onChange={(event) => setNutritionForm((current) => ({ ...current, baseAmount: event.target.value }))}
                  inputMode="numeric"
                  min="1"
                  step="1"
                  placeholder="예: 100"
                />
              </label>
              <label>
                <span>kcal</span>
                <input
                  value={nutritionForm.kcal}
                  onChange={(event) => setNutritionForm((current) => ({ ...current, kcal: event.target.value }))}
                  inputMode="numeric"
                  min="0"
                  step="1"
                />
              </label>
            </div>
            <div className="nutrition-manual-row nutrition-manual-row-three">
              <label>
                <span>Carb</span>
                <input
                  value={nutritionForm.carb}
                  onChange={(event) => setNutritionForm((current) => ({ ...current, carb: event.target.value }))}
                  inputMode="decimal"
                  min="0"
                  step="0.1"
                />
              </label>
              <label>
                <span>Pro</span>
                <input
                  value={nutritionForm.protein}
                  onChange={(event) => setNutritionForm((current) => ({ ...current, protein: event.target.value }))}
                  inputMode="decimal"
                  min="0"
                  step="0.1"
                />
              </label>
              <label>
                <span>Fat</span>
                <input
                  value={nutritionForm.fat}
                  onChange={(event) => setNutritionForm((current) => ({ ...current, fat: event.target.value }))}
                  inputMode="decimal"
                  min="0"
                  step="0.1"
                />
              </label>
            </div>
            <ModalActions onCancel={closeNutritionModal} submitText="추가" />
          </form>
        </Modal>
      )}

      {foodEditTarget && (
        <Modal title="음식 수정" onClose={closeFoodEditModal}>
          <form className="modal-form" onSubmit={saveFoodEdit}>
            <label>
              <span>음식명</span>
              <input
                value={foodEditForm.name}
                onChange={(event) =>
                  setFoodEditForm((current) => ({ ...current, name: cleanFoodName(event.target.value) }))
                }
                onKeyDown={handleFoodNameEditKeyDown}
                lang="ko"
                autoCapitalize="off"
              />
            </label>
            <label>
              <span>섭취량(g)</span>
              <input
                ref={foodEditAmountRef}
                value={foodEditForm.amount}
                onChange={(event) => setFoodEditForm((current) => ({ ...current, amount: event.target.value }))}
                inputMode="decimal"
                step="10"
                min="0"
                placeholder="예: 230"
              />
            </label>
            <ModalActions onCancel={closeFoodEditModal} submitText="수정" />
          </form>
        </Modal>
      )}

      {calendarOpen && (
        <CalendarSheet
          selectedDate={selectedDate}
          onSelect={selectCalendarDate}
          onClose={() => setCalendarOpen(false)}
          dailyRecords={dailyRecords}
        />
      )}

      {settingsOpen && (
        <div className="sheet-backdrop" role="presentation" onClick={() => setSettingsOpen(false)}>
          <div className="action-sheet" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <button type="button" onClick={() => { setSettingsOpen(false); setSetupScreen("result"); }}>목표 보기</button>
            <button type="button" onClick={openProfileEditor}>신체 정보 수정</button>
            <button type="button" className="danger-button" onClick={signOut}>로그아웃</button>
            <button type="button" className="ghost-button" onClick={() => setSettingsOpen(false)}>취소</button>
          </div>
        </div>
      )}

      {matchChoiceTarget && (
        <div className="sheet-backdrop" role="presentation" onClick={closeMatchChoice}>
          <div className="action-sheet match-choice-sheet" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="match-choice-summary">
              <strong>{matchChoiceTarget.aliasName}</strong>
              <span>→ {getFoodDisplayName(matchChoiceTarget.food)} 기준</span>
            </div>
            <button type="button" onClick={applyMatchOnce}>이번 항목에서만 적용</button>
            <button type="button" onClick={applyMatchForever}>앞으로도 이 이름으로 사용</button>
            <button type="button" className="ghost-button" onClick={closeMatchChoice}>취소</button>
          </div>
        </div>
      )}

      {actionTarget && (
        <div className="sheet-backdrop" role="presentation" onClick={() => setActionTarget(null)}>
          <div className="action-sheet" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            {actionTarget.type === "food" && (
              <button
                type="button"
                onClick={() => openFoodBasisModal(actionTarget.mealId, actionTarget.foodId)}
              >
                기준 음식 수정
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                if (actionTarget.type === "meal") startEditMeal(actionTarget.mealId);
                if (actionTarget.type === "food") startEditFood(actionTarget.mealId, actionTarget.foodId);
                if (actionTarget.type === "weight") editMorningWeight();
                if (actionTarget.type === "day") editCompletedDay();
              }}
            >
              수정하기
            </button>
            {actionTarget.type !== "day" && (
              <button
                type="button"
                className="danger-button"
                onClick={() => {
                  if (actionTarget.type === "meal") deleteMeal(actionTarget.mealId);
                  if (actionTarget.type === "food") deleteFood(actionTarget.mealId, actionTarget.foodId);
                  if (actionTarget.type === "weight") deleteMorningWeight();
                }}
              >
                삭제하기
              </button>
            )}
            <button type="button" className="ghost-button" onClick={() => setActionTarget(null)}>
              취소
            </button>
          </div>
        </div>
      )}
    </main>
  );
}


function MorningWeightCard({ value, inputValue, onInputChange, onRegister, onLongPress }) {
  const longPressProps = useLongPress(onLongPress);

  return (
    <section className="morning-weight-card compact-weight-card" aria-label="공복 체중 기록" {...(value ? longPressProps : {})}>
      <span>공복 체중</span>
      {value ? (
        <button className="weight-inline-value" type="button" onClick={onLongPress}>
          <strong>{formatAmount(toNumber(value))} kg</strong>
          <small>수정/삭제</small>
        </button>
      ) : (
        <div className="weight-inline-input">
          <input
            value={inputValue}
            min="30"
            max="200"
            step="0.1"
            inputMode="decimal"
            placeholder="78.0"
            onChange={(event) => onInputChange(event.target.value)}
          />
          <small>kg</small>
          <button className="weight-register-button" type="button" onClick={onRegister} disabled={toNumber(inputValue) <= 0}>
            등록
          </button>
        </div>
      )}
    </section>
  );
}

function RecordViewSwitch({ value, onChange }) {
  return (
    <div className="record-view-switch" role="group" aria-label="기록 종류">
      <button type="button" className={value === "diet" ? "is-active" : ""} onClick={() => onChange("diet")}>식단</button>
      <button type="button" className={value === "workout" ? "is-active" : ""} onClick={() => onChange("workout")}>운동</button>
    </div>
  );
}

function WorkoutScreen({
  selectedDateKey,
  savedEntries,
  dailyRecords,
  profile,
  onSave,
  onExerciseSettingChange,
}) {
  const [memo, setMemo] = useState(() => formatWorkoutMemo(savedEntries));
  const [statusMessage, setStatusMessage] = useState("");
  const [readiness, setReadiness] = useState(() => dailyRecords[selectedDateKey]?.workoutSession?.readiness || "normal");
  const [painFlag, setPainFlag] = useState(() => Boolean(dailyRecords[selectedDateKey]?.workoutSession?.painFlag));
  const [formFailure, setFormFailure] = useState(() => Boolean(dailyRecords[selectedDateKey]?.workoutSession?.formFailure));
  const [recommendationDrafts, setRecommendationDrafts] = useState(() =>
    (savedEntries || []).reduce((acc, entry) => entry.recommendation
      ? { ...acc, [normalizeExerciseName(entry.name)]: entry.recommendation }
      : acc, {})
  );

  useEffect(() => {
    setMemo(formatWorkoutMemo(savedEntries));
    setStatusMessage("");
    setReadiness(dailyRecords[selectedDateKey]?.workoutSession?.readiness || "normal");
    setPainFlag(Boolean(dailyRecords[selectedDateKey]?.workoutSession?.painFlag));
    setFormFailure(Boolean(dailyRecords[selectedDateKey]?.workoutSession?.formFailure));
    setRecommendationDrafts((savedEntries || []).reduce((acc, entry) => entry.recommendation
      ? { ...acc, [normalizeExerciseName(entry.name)]: entry.recommendation }
      : acc, {}));
    // 날짜가 바뀌면 해당 날짜의 저장 기록으로 입력창을 교체한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDateKey]);

  const draftExercises = useMemo(() => parseWorkoutMemo(memo), [memo]);
  const weeklyVolume = useMemo(
    () => calculateWeeklyVolume(dailyRecords, selectedDateKey, draftExercises),
    [dailyRecords, selectedDateKey, draftExercises]
  );
  const recommendationAccuracy = useMemo(() => getRecommendationAccuracy(dailyRecords), [dailyRecords]);
  const fatigueSummaries = draftExercises.map((exercise) => {
    const setting = getExerciseSetting(profile, exercise.name);
    const history = getExerciseHistory(dailyRecords, selectedDateKey, exercise.name, setting.equipment);
    const rolling = getRollingE1RM(history, exercise);
    return getFatigueAnalysis(history, rolling);
  });
  const highFatigueCount = fatigueSummaries.filter((item) => item.level === "high").length;
  const shouldShowRecoveryAlert = painFlag || highFatigueCount >= 2 || (readiness === "fatigued" && highFatigueCount >= 1);

  const applyRecommendation = (exercise, recommendation) => {
    if (!recommendation) return;
    const exerciseKey = normalizeExerciseName(exercise.name);
    const nextExercises = draftExercises.map((entry) =>
      normalizeExerciseName(entry.name) === exerciseKey
        ? { ...entry, sets: recommendation.sets.map((set) => ({ ...set })) }
        : entry
    );
    setMemo(formatWorkoutMemo(nextExercises));
    setRecommendationDrafts((current) => ({
      ...current,
      [exerciseKey]: {
        type: recommendation.type,
        label: recommendation.label,
        sourceDateKey: recommendation.sourceDateKey || "",
        appliedAt: new Date().toISOString(),
        sets: recommendation.sets.map((set) => ({ weight: set.weight, reps: set.reps, rir: set.rir })),
      },
    }));
    setStatusMessage(`${exercise.name}: ${recommendation.label} 추천을 입력했어요.`);
  };

  const saveWorkout = (event) => {
    event.preventDefault();
    const validEntries = draftExercises
      .filter((exercise) => exercise.name && exercise.sets.length > 0)
      .map((exercise) => ({
        ...exercise,
        id: `${selectedDateKey}-${normalizeExerciseName(exercise.name)}`,
        equipment: getExerciseSetting(profile, exercise.name).equipment || "",
        trainingGoal: getExerciseSetting(profile, exercise.name).trainingGoal,
        recommendation: recommendationDrafts[normalizeExerciseName(exercise.name)] || null,
        sets: exercise.sets.map((set, index) => ({ ...set, setIndex: index + 1, type: "working" })),
      }));

    if (memo.trim() && validEntries.length === 0) {
      setStatusMessage("운동명 아래에 ‘중량 반복수 @RIR’ 형식으로 한 세트 이상 입력해줘.");
      return;
    }

    onSave(validEntries, {
      readiness,
      painFlag,
      formFailure,
      savedAt: new Date().toISOString(),
    });
    setMemo(formatWorkoutMemo(validEntries));
    setStatusMessage(validEntries.length > 0 ? "운동 기록을 저장했어요." : "운동 기록을 비웠어요.");
  };

  return (
    <section className="workout-screen" aria-label="운동 기록">
      <section className="workout-readiness-card">
        <div className="workout-readiness-head">
          <div>
            <strong>오늘 회복 상태</strong>
            <small>추천 강도를 조정하는 보조 정보예요.</small>
          </div>
          <span className={`readiness-badge is-${readiness}`}>{readiness === "good" ? "좋음" : readiness === "fatigued" ? "피로" : "보통"}</span>
        </div>
        <div className="readiness-options" role="group" aria-label="오늘 회복 상태">
          <button type="button" className={readiness === "good" ? "is-active" : ""} onClick={() => setReadiness("good")}>좋음</button>
          <button type="button" className={readiness === "normal" ? "is-active" : ""} onClick={() => setReadiness("normal")}>보통</button>
          <button type="button" className={readiness === "fatigued" ? "is-active" : ""} onClick={() => setReadiness("fatigued")}>피로</button>
        </div>
        <div className="workout-condition-flags">
          <button type="button" className={painFlag ? "is-active is-warning" : ""} onClick={() => setPainFlag((current) => !current)}>통증 {painFlag ? "있음" : "없음"}</button>
          <button type="button" className={formFailure ? "is-active" : ""} onClick={() => setFormFailure((current) => !current)}>폼 붕괴 {formFailure ? "있음" : "없음"}</button>
        </div>
      </section>

      {shouldShowRecoveryAlert && (
        <section className="workout-recovery-alert">
          <strong>회복 주간 고려</strong>
          <span>여러 운동에서 피로 신호가 겹쳤어요. 앱은 세트 수를 바꾸지 않고 중량만 약 5% 낮춰 추천해요.</span>
          <small>정해진 주기로 강제하지 않으며, 통증이 있으면 자동 증량을 보류해요.</small>
        </section>
      )}

      <section className="workout-memo-card">
        <div className="section-title">
          <div>
            <strong>운동 메모</strong>
            <small>운동과 세트 수는 직접 결정해요.</small>
          </div>
          <span className="workout-swipe-hint">← 식단 · 운동 →</span>
        </div>

        <form onSubmit={saveWorkout}>
          <textarea
            className="workout-memo-input"
            value={memo}
            onChange={(event) => {
              setMemo(event.target.value);
              setStatusMessage("");
            }}
            rows={Math.max(10, memo.split(/\r?\n/).length + 2)}
            placeholder={`벤치프레스\n100 5 @2\n100 5 @2\n100 5 @1\n\n인클라인 덤벨프레스\n35 10 @2\n35 9 @1\n35 8 @1`}
            lang="ko-KR"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />

          <div className="workout-format-guide">
            <strong>입력 형식</strong>
            <span>중량 반복수 @RIR</span>
            <small>RIR을 모르면 ‘100 5’처럼 생략해도 돼요.</small>
          </div>

          {statusMessage && <p className={statusMessage.includes("입력해줘") ? "form-error" : "workout-status"}>{statusMessage}</p>}

          <div className="daily-memo-actions">
            <button
              type="button"
              className="ghost-button"
              disabled={!memo.trim()}
              onClick={() => {
                if (window.confirm("현재 운동 메모를 비울까요?")) {
                  setMemo("");
                  setStatusMessage("");
                }
              }}
            >
              비우기
            </button>
            <button type="submit" className="primary-button">운동 기록 저장</button>
          </div>
        </form>
      </section>

      {(weeklyVolume.rows.length > 0 || recommendationAccuracy.attempts > 0) && (
        <section className="workout-v2-dashboard">
          <div className="workout-dashboard-head">
            <div>
              <strong>최근 7일 분석</strong>
              <small>세트 수는 추천하지 않고 현재 패턴만 보여줘요.</small>
            </div>
            <div className="recommendation-accuracy">
              <span>추천 성공률</span>
              <strong>{recommendationAccuracy.attempts > 0 ? `${recommendationAccuracy.rate}%` : "-"}</strong>
              <small>{recommendationAccuracy.attempts}회 평가</small>
            </div>
          </div>

          {weeklyVolume.rows.length > 0 && (
            <div className="weekly-volume-list">
              {weeklyVolume.rows.map((row) => (
                <div className="weekly-volume-row" key={row.key}>
                  <span>{row.label}</span>
                  <div className="weekly-volume-track"><i style={{ width: `${Math.min(100, row.total / 20 * 100)}%` }} /></div>
                  <strong>{formatWorkoutNumber(row.total)}세트</strong>
                  <small>직접 {formatWorkoutNumber(row.direct)} · 간접 {formatWorkoutNumber(row.indirect)}</small>
                </div>
              ))}
            </div>
          )}

          <p className="volume-disclaimer">
            운동명 기반 추정치 · 매칭 신뢰도 {Math.round(weeklyVolume.mappingConfidence * 100)}%. 간접 세트는 0.5세트로 표시해요.
          </p>
        </section>
      )}

      {draftExercises.length > 0 && (
        <section className="workout-analysis-list" aria-label="운동 추천 분석">
          {draftExercises.map((exercise, index) => {
            const setting = getExerciseSetting(profile, exercise.name);
            const history = getExerciseHistory(dailyRecords, selectedDateKey, exercise.name, setting.equipment);
            const previous = history[0] || null;
            const rollingE1RM = getRollingE1RM(history, exercise);
            const rirReliability = getRirReliability(history, exercise);
            const baseFatigueAnalysis = getFatigueAnalysis(history, rollingE1RM);
            const fatigueAnalysis = painFlag
              ? { ...baseFatigueAnalysis, level: "high", painFlag: true, message: "오늘 통증이 표시되어 자동 증량을 보류해요." }
              : (readiness === "fatigued" || formFailure) && baseFatigueAnalysis.level === "normal"
                ? {
                    ...baseFatigueAnalysis,
                    level: "medium",
                    message: formFailure
                      ? "오늘 폼 붕괴가 표시되어 같은 목표를 한 번 더 확인해요."
                      : "오늘 회복 상태가 피로로 표시되어 증량을 한 번 보류해요.",
                  }
                : baseFatigueAnalysis;
            const recommendationConfidence = getRecommendationConfidence(history, rirReliability, setting.equipment);
            const recommendation = buildExerciseRecommendation(previous, profile, { rollingE1RM, fatigueAnalysis });
            if (recommendation) recommendation.sourceDateKey = previous?.dateKey || "";
            const currentE1RM = calculateExerciseE1RM(exercise);
            const previousE1RM = calculateExerciseE1RM(previous);
            const profile1RM = getProfile1RM(profile, exercise.name);
            const estimatedRir = exercise.sets[0]?.rir === null || exercise.sets[0]?.rir === undefined
              ? estimateSetRIR(exercise.sets[0], profile1RM || previousE1RM)
              : null;
            const firstGuide = previous ? null : getFirstLoadGuide(profile, exercise.name);
            const workWeight = exercise.sets[0]?.weight || recommendation?.sets[0]?.weight || firstGuide?.weight || 0;
            const warmups = getWarmupSets(workWeight, exercise.name);
            const repDrop = getRepDropAnalysis(exercise.sets.length > 0 ? exercise : previous);
            const lastOutcome = evaluateRecommendationOutcome(previous);

            return (
              <article className="workout-exercise-card" key={`${normalizeExerciseName(exercise.name)}-${index}`}>
                <div className="workout-exercise-head">
                  <div>
                    <strong>{exercise.name}</strong>
                    <span>{setting.label} · 목표 RIR {setting.targetRir}</span>
                  </div>
                  <div className="exercise-mode-toggle" role="group" aria-label={`${exercise.name} 과부하 방식`}>
                    <button
                      type="button"
                      className={setting.progressionMode === "reps" ? "is-active" : ""}
                      onClick={() => onExerciseSettingChange(exercise.name, "progressionMode", "reps")}
                    >
                      반복
                    </button>
                    <button
                      type="button"
                      className={setting.progressionMode === "load" ? "is-active" : ""}
                      onClick={() => onExerciseSettingChange(exercise.name, "progressionMode", "load")}
                    >
                      중량
                    </button>
                  </div>
                </div>

                <div className="exercise-context-controls">
                  <label>
                    <span>운동 목표</span>
                    <select value={setting.trainingGoal} onChange={(event) => onExerciseSettingChange(exercise.name, "trainingGoal", event.target.value)}>
                      {Object.entries(TRAINING_GOALS).map(([value, option]) => <option key={value} value={value}>{option.label}</option>)}
                    </select>
                  </label>
                  <label>
                    <span>기구</span>
                    <select value={setting.equipment} onChange={(event) => onExerciseSettingChange(exercise.name, "equipment", event.target.value)}>
                      <option value="">미지정</option>
                      {Object.entries(EQUIPMENT_OPTIONS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </label>
                </div>

                {previous ? (
                  <div className="previous-workout-box">
                    <div>
                      <span>이전 기록</span>
                      <small>{previous.dateKey}</small>
                    </div>
                    <strong>{previous.sets.map((set) => `${formatWorkoutNumber(set.weight)}×${set.reps}`).join(" · ")}</strong>
                    {lastOutcome && <em className={`recommendation-outcome is-${lastOutcome}`}>{lastOutcome === "success" ? "이전 추천 성공" : "이전 추천 미달"}</em>}
                  </div>
                ) : (
                  <div className="previous-workout-box is-empty">
                    <span>이전 기록 없음</span>
                    <small>첫 기록을 저장하면 다음 운동부터 추천해요.</small>
                  </div>
                )}

                {recommendation && (
                  <div className={`recommendation-box is-${recommendation.type}`}>
                    <div className="recommendation-copy">
                      <span>다음 추천 · 신뢰도 {recommendationConfidence.label}</span>
                      <strong>{recommendation.sets.map((set) => `${formatWorkoutNumber(set.weight)}×${set.reps}`).join(" · ")}</strong>
                      <small>{recommendation.reason}</small>
                    </div>
                    <button type="button" onClick={() => applyRecommendation(exercise, recommendation)}>추천 입력</button>
                  </div>
                )}

                <div className="exercise-metric-grid">
                  <div>
                    <span>Rolling e1RM</span>
                    <strong>{rollingE1RM.value > 0 ? `${formatWorkoutNumber(rollingE1RM.value)}kg` : "-"}</strong>
                    <small>{rollingE1RM.samples}회 기준</small>
                  </div>
                  <div>
                    <span>최근 추세</span>
                    <strong className={rollingE1RM.trendPercent < -3 ? "is-down" : rollingE1RM.trendPercent > 1 ? "is-up" : ""}>
                      {rollingE1RM.samples >= 2 ? `${rollingE1RM.trendPercent > 0 ? "+" : ""}${formatWorkoutNumber(rollingE1RM.trendPercent)}%` : "-"}
                    </strong>
                    <small>최대 3회</small>
                  </div>
                  <div>
                    <span>RIR 신뢰도</span>
                    <strong>{rirReliability.label}</strong>
                    <small>{Math.round(rirReliability.coverage * 100)}% 입력</small>
                  </div>
                </div>

                <div className={`fatigue-signal is-${fatigueAnalysis.level}`}>
                  <span>피로 신호</span>
                  <strong>{fatigueAnalysis.level === "high" ? "높음" : fatigueAnalysis.level === "medium" ? "관찰" : "정상"}</strong>
                  <small>{fatigueAnalysis.message}</small>
                </div>

                {repDrop && repDrop.level !== "normal" && (
                  <div className={`rep-drop-alert is-${repDrop.level}`}>
                    <strong>세트 간 반복수 {formatWorkoutNumber(repDrop.dropPercent)}% 감소</strong>
                    <span>휴식시간이나 첫 세트 강도가 과하지 않았는지 확인해봐요.</span>
                  </div>
                )}

                {firstGuide && (
                  <div className="first-load-guide">
                    <span>{firstGuide.label}</span>
                    <strong>{formatWorkoutNumber(firstGuide.weight)}kg · {firstGuide.reps}회부터</strong>
                    <small>세트 수는 직접 입력하고, 첫 기록 이후부터 점진적 과부하를 추천해요.</small>
                  </div>
                )}

                {(currentE1RM > 0 || previousE1RM > 0) && (
                  <div className="e1rm-row">
                    <span>e1RM</span>
                    <strong>{formatWorkoutNumber(currentE1RM || previousE1RM)}kg</strong>
                    <small>{currentE1RM > 0 ? `현재 입력 기준 · ${exercise.sets.some((set) => set.rir !== null && set.rir !== undefined) ? "RIR 반영" : "신뢰도 낮음"}` : "이전 기록 기준"}</small>
                  </div>
                )}

                {estimatedRir !== null && (
                  <div className="estimated-rir-row">
                    <span>첫 세트 추정 RIR</span>
                    <strong>{estimatedRir}</strong>
                    <small>입력한 1RM 기준의 참고값이에요.</small>
                  </div>
                )}

                {warmups.length > 0 && (
                  <div className="warmup-box">
                    <span>워밍업 가이드</span>
                    <strong>{warmups.map((set) => `${formatWorkoutNumber(set.weight)}×${set.reps}`).join(" → ")}</strong>
                    <small>작업세트에 포함되지 않아요.</small>
                  </div>
                )}
              </article>
            );
          })}
        </section>
      )}
    </section>
  );
}

function CalendarSheet({ selectedDate, onSelect, onClose, dailyRecords }) {
  const [viewDate, setViewDate] = useState(() => new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1));
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const startOffset = firstDay.getDay();
  const startDate = addDays(firstDay, -startOffset);
  const days = Array.from({ length: 42 }, (_, index) => addDays(startDate, index));

  return (
    <div className="sheet-backdrop calendar-backdrop" role="presentation" onClick={onClose}>
      <section className="calendar-sheet" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="calendar-head">
          <button type="button" onClick={() => setViewDate(new Date(year, month - 1, 1))}>‹</button>
          <strong>{year}년 {month + 1}월</strong>
          <button type="button" onClick={() => setViewDate(new Date(year, month + 1, 1))}>›</button>
        </div>
        <div className="calendar-weekdays">
          {['일', '월', '화', '수', '목', '금', '토'].map((day) => <span key={day}>{day}</span>)}
        </div>
        <div className="calendar-grid">
          {days.map((date) => {
            const key = getDateKey(date);
            const record = dailyRecords[key] || {};
            const isCurrentMonth = date.getMonth() === month;
            const isSelected = isSameDate(date, selectedDate);
            const isToday = isSameDate(date, new Date());
            const hasFood = Boolean(record.dayComplete || record.kcal);
            const hasWeight = toNumber(record.morningWeight) > 0;
            const hasWorkout = Array.isArray(record.workoutEntries) && record.workoutEntries.length > 0;

            return (
              <button
                key={key}
                type="button"
                className={[!isCurrentMonth ? "is-muted" : "", isToday ? "is-today" : "", isSelected ? "is-selected" : ""].filter(Boolean).join(" ")}
                onClick={() => { onSelect(date); onClose(); }}
              >
                <strong>{date.getDate()}</strong>
                <span>
                  {hasFood && <i className="food-dot" />}
                  {hasWeight && <i className="weight-dot" />}
                  {hasWorkout && <i className="workout-dot" />}
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function LoginScreen({ mode, form, error, message, loading, hasConfig, onModeChange, onFormChange, onSubmit }) {
  return (
    <main className="login-shell">
      <section className="login-card">
        <span className="login-kicker">Diet Memo</span>
        <h1>{mode === "signin" ? "로그인" : "회원가입"}</h1>
        <p>기록과 목표를 내 계정에 묶어서 폰에서도 이어서 쓸 수 있게 준비했어.</p>

        {!hasConfig && (
          <div className="config-warning">
            <strong>Supabase 설정 필요</strong>
            <span>.env에 VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY를 넣으면 로그인 가능해.</span>
          </div>
        )}

        <form className="login-form" onSubmit={onSubmit}>
          <label>
            <span>이메일</span>
            <input
              type="email"
              value={form.email}
              onChange={(event) => onFormChange("email", event.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
            />
          </label>
          <label>
            <span>비밀번호</span>
            <input
              type="password"
              value={form.password}
              onChange={(event) => onFormChange("password", event.target.value)}
              placeholder="6자 이상"
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
            />
          </label>

          {error && <p className="auth-error">{error}</p>}
          {message && <p className="auth-message">{message}</p>}

          <button className="setup-submit" type="submit" disabled={loading}>
            {loading ? "처리 중" : mode === "signin" ? "로그인" : "가입하기"}
          </button>
        </form>

        <button className="auth-switch" type="button" onClick={() => onModeChange(mode === "signin" ? "signup" : "signin")}>
          {mode === "signin" ? "계정이 없으면 가입하기" : "이미 계정이 있으면 로그인"}
        </button>
      </section>
    </main>
  );
}

function BottomNav({ activeTab, onChange }) {
  return (
    <nav className="bottom-nav" aria-label="하단 메뉴">
      <button className={activeTab === "record" ? "is-active" : ""} type="button" onClick={() => onChange("record")}>
        <span>▤</span>
        기록
      </button>
      <button className={activeTab === "stats" ? "is-active" : ""} type="button" onClick={() => onChange("stats")}>
        <span>▥</span>
        통계
      </button>
      <button className={activeTab === "foods" ? "is-active" : ""} type="button" onClick={() => onChange("foods")}>
        <span>▦</span>
        나의 음식
      </button>
    </nav>
  );
}

function SetupScreen({ profile, onProfileChange, onSubmit }) {
  const canCalculate = isRequiredProfileFilled(profile);

  return (
    <main className="setup-shell setup-calculator-shell">
      <section className="daily-calc-hero">
        <span>목표 설정</span>
        <h1>일일 칼로리 계산</h1>
      </section>

      <form className="daily-calc-form" onSubmit={onSubmit}>
        <section className="daily-calc-section">
          <div className="section-title">
            <strong>기본 정보 <em>(필수)</em></strong>
          </div>

          <div className="profile-row gender-row">
            <span className="row-icon">성</span>
            <strong>성별</strong>
            <div className="mini-segmented" role="group" aria-label="성별">
              <button
                type="button"
                className={profile.sex === "male" ? "is-selected" : ""}
                onClick={() => onProfileChange("sex", "male")}
              >
                남성
              </button>
              <button
                type="button"
                className={profile.sex === "female" ? "is-selected" : ""}
                onClick={() => onProfileChange("sex", "female")}
              >
                여성
              </button>
            </div>
          </div>

          <div className="profile-row">
            <span className="row-icon">나</span>
            <strong>나이</strong>
            <input value={profile.age} min="14" max="90" inputMode="numeric" onChange={(event) => onProfileChange("age", event.target.value)} />
            <small>세</small>
          </div>

          <div className="profile-row">
            <span className="row-icon">키</span>
            <strong>키</strong>
            <input value={profile.height} min="120" max="230" inputMode="decimal" onChange={(event) => onProfileChange("height", event.target.value)} />
            <small>cm</small>
          </div>

          <div className="profile-row">
            <span className="row-icon">몸</span>
            <strong>체중</strong>
            <input value={profile.weight} min="30" max="200" step="0.1" inputMode="decimal" onChange={(event) => onProfileChange("weight", event.target.value)} />
            <small>kg</small>
          </div>

        </section>

        <BodyCompositionField profile={profile} onProfileChange={onProfileChange} />

        <section className="daily-calc-section">
          <div className="section-title">
            <strong>활동량 <em>(필수)</em></strong>
          </div>
          <p className="section-helper">평소 생활 및 직업에서의 움직임 정도를 선택해주세요.</p>

          <div className="activity-list">
            {JOB_ACTIVITY_OPTIONS.map((option) => (
              <ActivityOptionCard
                key={option.value}
                option={option}
                selected={profile.jobActivity === option.value}
                onSelect={() => {
                  onProfileChange("jobActivity", option.value);
                  onProfileChange("steps", "");
                }}
              />
            ))}
          </div>

          <SetupInlineNumberField
            label="웨이트 주 횟수"
            unit="회/주"
            value={profile.weightSessions}
            min="0"
            max="14"
            onChange={(value) => onProfileChange("weightSessions", value)}
          />
        </section>

        <section className="daily-calc-section training-setup-section">
          <div className="section-title">
            <strong>운동 설정 <em>(선택)</em></strong>
            <small>추천 기본값</small>
          </div>
          <p className="section-helper">운동은 사용자가 고르고, 앱은 선택한 방식으로 중량과 반복수만 추천해요.</p>

          <div className="training-setting-block">
            <strong>훈련 목표</strong>
            <div className="training-choice-grid" role="group" aria-label="훈련 목표">
              {Object.entries(TRAINING_GOALS).map(([value, option]) => (
                <button
                  key={value}
                  type="button"
                  className={(profile.trainingGoal || "hypertrophy") === value ? "is-selected" : ""}
                  onClick={() => onProfileChange("trainingGoal", value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="training-setting-block">
            <strong>점진적 과부하 방식</strong>
            <div className="training-choice-grid training-progression-grid" role="group" aria-label="점진적 과부하 방식">
              <button
                type="button"
                className={(profile.progressionMode || "reps") === "reps" ? "is-selected" : ""}
                onClick={() => onProfileChange("progressionMode", "reps")}
              >
                반복수 증가
              </button>
              <button
                type="button"
                className={profile.progressionMode === "load" ? "is-selected" : ""}
                onClick={() => onProfileChange("progressionMode", "load")}
              >
                중량 증가
              </button>
            </div>
          </div>

          <div className="big-lift-inputs">
            <strong>4대 운동 1RM <em>(모르면 비워두기)</em></strong>
            <div className="big-lift-grid">
              <SetupInlineNumberField label="스쿼트" unit="kg" value={profile.squat1RM} min="0" max="500" step="0.5" onChange={(value) => onProfileChange("squat1RM", value)} />
              <SetupInlineNumberField label="벤치프레스" unit="kg" value={profile.bench1RM} min="0" max="400" step="0.5" onChange={(value) => onProfileChange("bench1RM", value)} />
              <SetupInlineNumberField label="데드리프트" unit="kg" value={profile.deadlift1RM} min="0" max="600" step="0.5" onChange={(value) => onProfileChange("deadlift1RM", value)} />
              <SetupInlineNumberField label="OHP" unit="kg" value={profile.ohp1RM} min="0" max="300" step="0.5" onChange={(value) => onProfileChange("ohp1RM", value)} />
            </div>
          </div>
        </section>

        <section className="daily-calc-section">
          <div className="section-title">
            <strong>목표 <em>(필수)</em></strong>
            <small>칼로리 보정</small>
          </div>

          <div className="goal-card-group" role="group" aria-label="목표">
            {Object.entries(GOAL_OPTIONS).map(([value, option]) => (
              <button
                key={value}
                type="button"
                className={profile.goal === value ? "is-selected" : ""}
                onClick={() => onProfileChange("goal", value)}
              >
                <strong>{option.label}</strong>
                <span>{option.helper}</span>
              </button>
            ))}
          </div>
        </section>

        {!canCalculate && <p className="setup-required-hint">성별, 나이, 키, 체중, 목표, 웨이트 횟수, 직업 활동량을 입력하면 계산할 수 있어요.</p>}

        <button className="setup-submit" type="submit" disabled={!canCalculate}>
          계산하기
        </button>
      </form>
    </main>
  );
}


function NumberField({ label, unit, value, min, max, step = "1", onChange }) {
  return (
    <label className="number-field">
      <span>{label}</span>
      <div>
        <input
          value={value || ""}
          min={min}
          max={max}
          step={step}
          inputMode={step === "1" ? "numeric" : "decimal"}
          onChange={(event) => onChange(event.target.value)}
        />
        <small>{unit}</small>
      </div>
    </label>
  );
}

function SetupInlineNumberField({ label, meta, unit, value, min, max, step = "1", onChange }) {
  return (
    <label className="setup-inline-field">
      <strong>
        {label}
        {meta && <em>({meta})</em>}
      </strong>
      <div className="setup-inline-control">
        <input
          value={value || ""}
          min={min}
          max={max}
          step={step}
          inputMode={step === "1" ? "numeric" : "decimal"}
          onChange={(event) => onChange(event.target.value)}
        />
        <small>{unit}</small>
      </div>
    </label>
  );
}

function BodyCompositionField({ profile, onProfileChange }) {
  const bodyFatInputValue = profile.bodyFatValue !== undefined && profile.bodyFatValue !== null
    ? profile.bodyFatValue
    : profile.bodyFatMass || "";

  const getBodyCompositionMode = (muscleMass, bodyFatValue) => {
    const hasMuscle = muscleMass !== "" && muscleMass !== undefined && toNumber(muscleMass) > 0;
    const hasFat = bodyFatValue !== "" && bodyFatValue !== undefined && toNumber(bodyFatValue) > 0;

    if (hasMuscle && hasFat) return "both";
    if (hasMuscle) return "muscle";
    if (hasFat) return "fat";
    return "none";
  };

  const updateMuscleMass = (value) => {
    onProfileChange("muscleMass", value);
    onProfileChange("bodyCompositionMode", getBodyCompositionMode(value, bodyFatInputValue));
  };

  const updateBodyFatValue = (value) => {
    onProfileChange("bodyFatValue", value);
    onProfileChange("bodyCompositionMode", getBodyCompositionMode(profile.muscleMass, value));
  };

  return (
    <section className="body-composition-section">
      <div className="section-title">
        <strong>체성분 <em>(선택)</em></strong>
      </div>

      <div className="body-composition-card">
        <div className="body-composition-row">
          <strong>골격근량</strong>
          <div className="body-composition-control">
            <input
              value={profile.muscleMass || ""}
              min="0"
              max="100"
              step="0.1"
              inputMode="decimal"
              onChange={(event) => updateMuscleMass(event.target.value)}
            />
            <small>kg</small>
          </div>
        </div>

        <div className="body-composition-row body-composition-fat-row">
          <strong>체지방</strong>
          <div className="body-composition-control body-composition-fat-control">
            <input
              value={bodyFatInputValue || ""}
              min="0"
              max={profile.bodyFatUnit === "percent" ? "70" : "140"}
              step="0.1"
              inputMode="decimal"
              onChange={(event) => updateBodyFatValue(event.target.value)}
            />
            <select value={profile.bodyFatUnit || "kg"} onChange={(event) => onProfileChange("bodyFatUnit", event.target.value)}>
              <option value="kg">kg</option>
              <option value="percent">%</option>
            </select>
          </div>
        </div>
      </div>
    </section>
  );
}

function ActivityOptionCard({ option, selected, onSelect }) {
  return (
    <button type="button" className={selected ? "activity-option is-selected" : "activity-option"} onClick={onSelect}>
      <div>
        <strong>{option.label}</strong>
        <small>{option.description}</small>
      </div>
      {selected && <i>✓</i>}
    </button>
  );
}

function MiniInfoCard({ title, body, tone }) {
  return (
    <article className={"mini-info-card " + tone}>
      <strong>{title}</strong>
      <span>{body}</span>
    </article>
  );
}


function PlanResultScreen({ plan, onPlanChange, onBack, onStart }) {
  const createTargetForm = (targetPlan) => ({
    calorieGoal: String(targetPlan.calorieGoal),
    carb: String(targetPlan.macroTargets.carb),
    protein: String(targetPlan.macroTargets.protein),
    fat: String(targetPlan.macroTargets.fat),
  });

  const [isEditingTargets, setIsEditingTargets] = useState(false);
  const [isFormulaOpen, setIsFormulaOpen] = useState(false);
  const [targetForm, setTargetForm] = useState(() => createTargetForm(plan));
  const [targetLocks, setTargetLocks] = useState({ carb: false, protein: false, fat: false });
  const [autoBalance, setAutoBalance] = useState(true);

  useEffect(() => {
    setTargetForm(createTargetForm(plan));
    setTargetLocks({ carb: false, protein: false, fat: false });
  }, [plan.calorieGoal, plan.macroTargets.carb, plan.macroTargets.protein, plan.macroTargets.fat]);

  const formValues = getTargetFormValues(targetForm);
  const macroCalories = getMacroCalories(formValues);
  const calorieGap = getMacroCalorieGap(formValues);
  const gapTone = getGapTone(calorieGap);
  const allMacrosLocked = targetLocks.carb && targetLocks.protein && targetLocks.fat;

  const planCarbCalories = plan.macroTargets.carb * 4;
  const planProteinCalories = plan.macroTargets.protein * 4;
  const planFatCalories = plan.macroTargets.fat * 9;
  const macroTotal = planCarbCalories + planProteinCalories + planFatCalories;
  const carbPercent = macroTotal > 0 ? Math.round((planCarbCalories / macroTotal) * 100) : 0;
  const proteinPercent = macroTotal > 0 ? Math.round((planProteinCalories / macroTotal) * 100) : 0;
  const fatPercent = Math.max(0, 100 - carbPercent - proteinPercent);
  const targetBasisText = plan.isManualTarget
    ? "사용자 지정 목표"
    : plan.goalLabel === "벌크"
      ? "유지 칼로리 대비 +8%"
      : plan.goalLabel === "감량"
        ? "유지 칼로리 대비 -17%"
        : "유지 칼로리 기준";
  const targetGuideText = plan.isManualTarget
    ? "수정한 목표가 기록창과 통계창에 반영됩니다."
    : plan.guide;
  const goalMultiplierText = plan.isManualTarget
    ? "사용자 직접 수정"
    : plan.goalLabel === "벌크"
      ? "× 1.08"
      : plan.goalLabel === "감량"
        ? "× 0.83"
        : "× 1.00";
  const calorieFormulaText = plan.isManualTarget
    ? "사용자가 직접 수정한 목표 칼로리입니다."
    : `(${plan.details.bmr.toLocaleString()} + ${plan.details.activityCalories.toLocaleString()} + ${plan.details.tef.toLocaleString()}) ${goalMultiplierText} = ${plan.calorieGoal.toLocaleString()} kcal`;

  const updateTargetInput = (field, value) => {
    const cleanValue = cleanIntegerInput(value);

    if (["carb", "protein", "fat"].includes(field)) {
      setTargetLocks((current) => ({ ...current, [field]: true }));
    }

    setTargetForm((current) => ({ ...current, [field]: cleanValue }));
  };

  const balanceTargetForm = (changedField = "calorieGoal", nextLocks = targetLocks) => {
    setTargetForm((current) => {
      const values = getTargetFormValues(current);
      if (values.calorieGoal <= 0) return current;
      return targetValuesToForm(balanceTargetValues(values, nextLocks, changedField));
    });
  };

  const handleTargetBlur = (field) => {
    if (!autoBalance) return;
    balanceTargetForm(field);
  };

  const toggleMacroLock = (macro) => {
    setTargetLocks((current) => {
      const nextLocks = { ...current, [macro]: !current[macro] };
      if (autoBalance && current[macro]) {
        requestAnimationFrame(() => balanceTargetForm(macro, nextLocks));
      }
      return nextLocks;
    });
  };

  const toggleAutoBalance = () => {
    setAutoBalance((current) => {
      const nextValue = !current;
      if (nextValue) {
        requestAnimationFrame(() => balanceTargetForm("calorieGoal"));
      }
      return nextValue;
    });
  };

  const saveTargetEdit = (event) => {
    event.preventDefault();
    const values = getTargetFormValues(targetForm);
    if (values.calorieGoal <= 0) return;

    onPlanChange(values);
    setIsEditingTargets(false);
  };

  return (
    <main className="setup-shell">
      <section className="result-hero result-target-hero">
        <div className="result-hero-top">
          <div className="result-target-copy">
            <span>하루 목표 칼로리</span>
            <div className="target-calorie-title-row">
              <strong>{plan.calorieGoal.toLocaleString()} kcal</strong>
              <button className="target-help-button" type="button" onClick={() => setIsFormulaOpen(true)} aria-label="목표 칼로리 계산 설명 보기">
                ?
              </button>
            </div>
          </div>
          <div className="result-hero-actions">
            <em>{plan.isManualTarget ? "사용자 지정" : plan.goalLabel}</em>
            <button className="target-edit-button" type="button" onClick={() => setIsEditingTargets((current) => !current)}>
              {isEditingTargets ? "닫기" : "목표 수정"}
            </button>
          </div>
        </div>

        <div className="target-basis-row">
          <span>설정 기준</span>
          <strong>{targetBasisText}</strong>
        </div>
        <p>{targetGuideText}</p>

        {isEditingTargets && (
          <form className="target-edit-form" onSubmit={saveTargetEdit}>
            <div className="target-edit-head">
              <div>
                <strong>하루 목표 직접 수정</strong>
                <span>잠기지 않은 영양소만 자동으로 보정돼요.</span>
              </div>
              <button className={autoBalance ? "auto-balance-toggle is-on" : "auto-balance-toggle"} type="button" onClick={toggleAutoBalance}>
                자동 보정 {autoBalance ? "ON" : "OFF"}
              </button>
            </div>

            <label className="target-input-row target-calorie-row">
              <span>목표 칼로리</span>
              <div className="target-input-shell">
                <input
                  value={targetForm.calorieGoal}
                  min="1"
                  step="1"
                  inputMode="numeric"
                  onChange={(event) => updateTargetInput("calorieGoal", event.target.value)}
                  onBlur={() => handleTargetBlur("calorieGoal")}
                />
                <small>kcal</small>
              </div>
            </label>

            <div className="target-macro-edit-grid">
              <TargetMacroInput
                label="탄수화물"
                value={targetForm.carb}
                unit="g"
                locked={targetLocks.carb}
                onChange={(value) => updateTargetInput("carb", value)}
                onBlur={() => handleTargetBlur("carb")}
                onToggleLock={() => toggleMacroLock("carb")}
              />
              <TargetMacroInput
                label="단백질"
                value={targetForm.protein}
                unit="g"
                locked={targetLocks.protein}
                onChange={(value) => updateTargetInput("protein", value)}
                onBlur={() => handleTargetBlur("protein")}
                onToggleLock={() => toggleMacroLock("protein")}
              />
              <TargetMacroInput
                label="지방"
                value={targetForm.fat}
                unit="g"
                locked={targetLocks.fat}
                onChange={(value) => updateTargetInput("fat", value)}
                onBlur={() => handleTargetBlur("fat")}
                onToggleLock={() => toggleMacroLock("fat")}
              />
            </div>

            <div className={"target-balance-card " + gapTone}>
              <div>
                <span>탄단지 합산</span>
                <strong>{macroCalories.toLocaleString()} kcal</strong>
              </div>
              <div>
                <span>목표와 차이</span>
                <strong>{calorieGap > 0 ? "+" : ""}{calorieGap.toLocaleString()} kcal</strong>
              </div>
              <p>
                {Math.abs(calorieGap) <= 20
                  ? "반올림 오차 범위라 그대로 사용해도 괜찮아요."
                  : allMacrosLocked
                    ? "모든 영양소가 잠겨 있어 자동 보정하지 않았어요. 그대로 저장할 수 있어요."
                    : "차이가 커요. 그대로 저장할 수 있지만 목표 달성률이 어색할 수 있어요."}
              </p>
            </div>

            <div className="target-edit-actions">
              <button className="ghost-button" type="button" onClick={() => balanceTargetForm("calorieGoal")}>
                자동 보정 적용
              </button>
              <button className="primary-button" type="submit">수정 반영</button>
            </div>
          </form>
        )}
      </section>

      <section className="result-card macro-result-card">
        <div className="section-title">
          <strong>매크로 영양소</strong>
          <small>하루 목표</small>
        </div>
        <div className="macro-result-layout">
          <div
            className="macro-donut"
            style={{
              "--carb": carbPercent + "%",
              "--protein": carbPercent + proteinPercent + "%",
            }}
          />
          <div className="macro-result-list">
            <MacroLegend label="탄수화물" value={plan.macroTargets.carb} percent={carbPercent} tone="carb" />
            <MacroLegend label="단백질" value={plan.macroTargets.protein} percent={proteinPercent} tone="protein" />
            <MacroLegend label="지방" value={plan.macroTargets.fat} percent={fatPercent} tone="fat" />
          </div>
        </div>
      </section>

      <section className="result-card">
        <div className="section-title">
          <strong>계산 구조</strong>
          <small>Mifflin-St Jeor 기반</small>
        </div>
        <div className="formula-flow">
          <FormulaStep number="1" title="기초대사량(BMR)" value={plan.details.bmr + " kcal"} />
          <FormulaStep number="2" title="활동 소모량" value={plan.details.activityCalories + " kcal"} />
          <FormulaStep number="3" title="소화 소모량(TEF)" value={plan.details.tef + " kcal"} />
          <FormulaStep number="4" title="유지 칼로리(TDEE)" value={plan.details.tdee + " kcal"} />
          <FormulaStep number="5" title="목표 보정" value={plan.isManualTarget ? "사용자 수정" : plan.goalLabel + " 기준"} />
        </div>
      </section>

      <section className="result-card detail-card">
        <div className="section-title">
          <strong>상세 정보</strong>
          <small>입력값 기준</small>
        </div>
        <DetailRow label="체지방률" value={plan.details.bodyFatRate > 0 ? formatMacro(plan.details.bodyFatRate) + " %" : "미입력"} />
        <DetailRow label="제지방량" value={plan.details.leanMass > 0 ? formatMacro(plan.details.leanMass) + " kg" : "미입력"} />
        <DetailRow label="체중" value={formatMacro(plan.profile.weight) + " kg"} />
        <DetailRow label="골격근량" value={plan.profile.muscleMass > 0 ? formatMacro(plan.profile.muscleMass) + " kg" : "미입력"} />
      </section>

      {isFormulaOpen && (
        <Modal title="목표 칼로리 계산 기준" onClose={() => setIsFormulaOpen(false)} className="target-formula-modal">
          <div className="formula-explain">
            <p>
              목표 칼로리는 <strong>기초대사량 + 활동 소모량 + 소화 소모량</strong>으로 유지 칼로리를 구한 뒤,
              선택한 목표에 따라 보정해서 산출해요.
            </p>
            <div className="formula-summary-box">
              <span>계산식</span>
              <strong>{calorieFormulaText}</strong>
            </div>
            <div className="formula-detail-list">
              <DetailRow label="기초대사량(BMR)" value={plan.details.bmr.toLocaleString() + " kcal"} />
              <DetailRow label="활동 소모량" value={plan.details.activityCalories.toLocaleString() + " kcal"} />
              <DetailRow label="소화 소모량(TEF)" value={plan.details.tef.toLocaleString() + " kcal"} />
              <DetailRow label="유지 칼로리(TDEE)" value={plan.details.tdee.toLocaleString() + " kcal"} />
              <DetailRow label="목표 보정" value={plan.isManualTarget ? "사용자 수정" : plan.goalLabel + " " + goalMultiplierText} />
              <DetailRow label="최종 목표" value={plan.calorieGoal.toLocaleString() + " kcal"} />
            </div>
            <p className="modal-hint">
              이 값은 초기 추정치이고, 7일 평균 공복 체중 변화에 따라 자동으로 +150/-150kcal 보정돼요.
            </p>
          </div>
        </Modal>
      )}

      <div className="result-actions">
        <button className="ghost-button" type="button" onClick={onBack}>다시 입력</button>
        <button className="primary-button" type="button" onClick={onStart}>식단·운동 기록 시작</button>
      </div>
    </main>
  );
}

function TargetMacroInput({ label, value, unit, locked, onChange, onBlur, onToggleLock }) {
  return (
    <label className="target-input-row target-macro-input">
      <span>{label}</span>
      <div className="target-input-shell">
        <input
          value={value}
          min="0"
          step="1"
          inputMode="numeric"
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
        />
        <small>{unit}</small>
      </div>
      <button className={locked ? "macro-lock-button is-locked" : "macro-lock-button"} type="button" onClick={onToggleLock}>
        {locked ? "잠금" : "자동"}
      </button>
    </label>
  );
}

function FormulaStep({ number, title, value }) {
  return (
    <div className="formula-step">
      <span>{number}</span>
      <strong>{title}</strong>
      <em>{value}</em>
    </div>
  );
}

function DetailRow({ label, value }) {
  return (
    <div className="detail-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SummaryItem({ label, value, highlight }) {
  return (
    <div className={highlight === undefined ? "summary-item" : "summary-item " + (highlight ? "is-good" : "is-over")}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function MacroBar({ label, macro, value, target, profile }) {
  const percent = target > 0 ? Math.min(100, Math.round((value / target) * 100)) : 0;
  const status = getMacroIntakeStatus(macro, value, target, profile);

  return (
    <div className="macro-row">
      <div className="macro-copy">
        <span>{label}</span>
        <strong>
          {formatMacro(value)}/{target}g
        </strong>
      </div>
      {status.message && <small className="form-error">{status.message}</small>}
      <div className="macro-track">
        <div className={status.isOver ? "macro-fill is-over" : "macro-fill"} style={{ width: percent + "%" }} />
      </div>
    </div>
  );
}
