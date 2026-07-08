import { FALLBACK_PROFILE, GOAL_OPTIONS, JOB_ACTIVITY_OPTIONS } from "../constants/app";

export function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatMacro(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function formatAmount(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function getNumericProfile(profile) {
  const weight = clamp(toNumber(profile.weight) || FALLBACK_PROFILE.weight, 30, 200);
  const bodyFatUnit = profile.bodyFatUnit || "kg";
  const inferredBodyCompositionMode = inferBodyCompositionMode(profile);
  const storedBodyCompositionMode = ["none", "muscle", "fat", "both"].includes(profile.bodyCompositionMode)
    ? profile.bodyCompositionMode
    : "";
  const bodyCompositionMode = storedBodyCompositionMode === "none" && inferredBodyCompositionMode !== "none"
    ? inferredBodyCompositionMode
    : storedBodyCompositionMode || inferredBodyCompositionMode;
  const hasFatInput = bodyCompositionMode === "fat" || bodyCompositionMode === "both";
  const hasMuscleInput = bodyCompositionMode === "muscle" || bodyCompositionMode === "both";
  const rawBodyFatValue = hasFatInput ? toNumber(profile.bodyFatValue ?? profile.bodyFatMass) : 0;
  const bodyFatRate = hasFatInput
    ? bodyFatUnit === "percent"
      ? clamp(rawBodyFatValue, 0, 70)
      : weight > 0
        ? (clamp(rawBodyFatValue, 0, weight * 0.7) / weight) * 100
        : 0
    : 0;
  const bodyFatMass = hasFatInput
    ? bodyFatUnit === "percent"
      ? weight * (bodyFatRate / 100)
      : clamp(rawBodyFatValue, 0, weight * 0.7)
    : 0;

  return {
    ...profile,
    age: clamp(toNumber(profile.age) || FALLBACK_PROFILE.age, 14, 90),
    height: clamp(toNumber(profile.height) || FALLBACK_PROFILE.height, 120, 230),
    weight,
    bodyCompositionMode,
    bodyFatValue: rawBodyFatValue,
    bodyFatUnit,
    bodyFatMass,
    bodyFatRate,
    muscleMass: hasMuscleInput ? clamp(toNumber(profile.muscleMass), 0, 100) : 0,
    steps: clamp(toNumber(profile.steps), 0, 40000),
    weightSessions: clamp(toNumber(profile.weightSessions), 0, 14),
    cardioSessions: clamp(toNumber(profile.cardioSessions), 0, 14),
    cardioMinutes: clamp(toNumber(profile.cardioMinutes), 0, 300),
  };
}

function inferBodyCompositionMode(profile) {
  const hasMuscle = profile.muscleMass !== "" && profile.muscleMass !== undefined && toNumber(profile.muscleMass) > 0;
  const fatValue = profile.bodyFatValue ?? profile.bodyFatMass;
  const hasFat = fatValue !== "" && fatValue !== undefined && toNumber(fatValue) > 0;
  if (hasMuscle && hasFat) return "both";
  if (hasMuscle) return "muscle";
  if (hasFat) return "fat";
  return "none";
}

export function getMifflinBmr(data) {
  const base = 10 * data.weight + 6.25 * data.height - 5 * data.age;
  return Math.round(data.sex === "female" ? base - 161 : base + 5);
}

const GOAL_CALORIE_MULTIPLIERS = {
  lose: 0.83,
  maintain: 1,
  bulk: 1.08,
};

const TEF_RATE = 0.08;
const LIVING_CALORIES = 0;

export function getGoalCalorieMultiplier(goalKey) {
  return GOAL_CALORIE_MULTIPLIERS[goalKey] ?? GOAL_CALORIE_MULTIPLIERS.maintain;
}

export function getStepCalories(steps) {
  const value = toNumber(steps);
  if (value <= 3000) return 0;
  if (value <= 5000) return 100;
  if (value <= 8000) return 200;
  if (value <= 10000) return 300;
  return 400;
}

export function getWeightTrainingCalories(sessions) {
  const value = toNumber(sessions);
  if (value <= 0) return 0;
  if (value <= 2) return 80;
  if (value <= 4) return 150;
  if (value <= 6) return 250;
  return 300;
}

export function getJobCalories(jobActivity) {
  const caloriesByJob = {
    sedentary: 0,
    light: 100,
    moderate: 150,
    high: 250,
    physical: 400,
  };

  return caloriesByJob[jobActivity] ?? caloriesByJob.light;
}

export function getCardioCalories(data) {
  return 0;
}

export function buildMacroTargets(calorieGoal, data, goalKey) {
  const proteinMultiplier = 2.0;
  const fatMultiplier = goalKey === "lose" ? 0.9 : 1.0;
  const protein = Math.max(0, Math.round(data.weight * proteinMultiplier));
  const fat = Math.max(0, Math.round(data.weight * fatMultiplier));
  const proteinKcal = protein * MACRO_CALORIE_FACTORS.protein;
  const fatKcal = fat * MACRO_CALORIE_FACTORS.fat;
  const carb = Math.max(0, Math.round((calorieGoal - proteinKcal - fatKcal) / MACRO_CALORIE_FACTORS.carb));

  return { carb, protein, fat };
}

export function getMacroIntakeStatus(macro, value, target, profileOrWeight) {
  const amount = Math.max(0, toNumber(value));
  const targetValue = Math.max(0, toNumber(target));
  const weight = Math.max(0, toNumber(profileOrWeight?.weight ?? profileOrWeight));

  if (macro === "protein") {
    const excessiveProtein = weight > 0 ? weight * 2.5 : targetValue * 1.2;
    if (excessiveProtein > 0 && amount > excessiveProtein) {
      return {
        tone: "warning",
        isOver: true,
        isLow: false,
        message: "단백질이 체중 대비 과도하게 높아요. 하루 총량을 조금 조절해보세요.",
      };
    }
    return { tone: "ok", isOver: false, isLow: false, message: "" };
  }

  if (targetValue > 0 && amount > targetValue) {
    return { tone: "warning", isOver: true, isLow: false, message: "" };
  }

  return { tone: "ok", isOver: false, isLow: false, message: "" };
}

export function buildNutritionPlan(profile) {
  const data = getNumericProfile(profile);
  const goalKey = data.goal || FALLBACK_PROFILE.goal;
  const goal = GOAL_OPTIONS[goalKey] || GOAL_OPTIONS.maintain;
  const job = JOB_ACTIVITY_OPTIONS.find((option) => option.value === (data.jobActivity || FALLBACK_PROFILE.jobActivity)) || JOB_ACTIVITY_OPTIONS[1];
  const leanMass = data.bodyFatMass > 0 ? clamp(data.weight - data.bodyFatMass, data.weight * 0.35, data.weight) : 0;
  const bmr = getMifflinBmr(data);
  const effectiveSteps = data.steps > 0 ? data.steps : job.defaultSteps;
  const livingCalories = LIVING_CALORIES;
  const stepCalories = getStepCalories(effectiveSteps);
  const weightCalories = getWeightTrainingCalories(data.weightSessions);
  const cardioCalories = 0;
  const jobCalories = getJobCalories(data.jobActivity || FALLBACK_PROFILE.jobActivity);
  const activityCalories = stepCalories + weightCalories + cardioCalories + jobCalories;
  const subtotal = bmr + activityCalories;
  const tef = Math.round(subtotal * TEF_RATE);
  const tdee = Math.round(subtotal + tef);
  const calorieGoal = Math.round((tdee * getGoalCalorieMultiplier(goalKey)) / 10) * 10;
  const macroTargets = buildMacroTargets(calorieGoal, data, goalKey);
  const bodyFatRate = data.bodyFatRate;

  return {
    profile: data,
    goalKey,
    goalLabel: goal.label,
    calorieGoal,
    baseCalorieGoal: calorieGoal,
    adjustmentKcal: 0,
    macroTargets,
    details: {
      bmr,
      leanMass,
      bodyFatRate,
      livingCalories,
      stepCalories,
      weightCalories,
      cardioCalories,
      jobCalories,
      effectiveSteps,
      activityCalories,
      estimatedTdeeBeforeTef: subtotal,
      tef,
      tdee,
    },
    adaptive: {
      status: "idle",
      message: "공복 체중 기록이 쌓이면 목표 칼로리를 자동으로 점검합니다.",
    },
    adjustmentHistory: [],
    lastAdjustmentEndKey: "",
    guide:
      goalKey === "bulk"
        ? "7일 평균 체중 증가 속도를 보고 목표 칼로리를 자동 보정합니다."
        : goalKey === "lose"
          ? "7일 평균 체중 감소 속도를 보고 목표 칼로리를 자동 보정합니다."
          : "7일 평균 체중이 유지 범위를 벗어나면 목표 칼로리를 자동 보정합니다.",
  };
}

function getLocalDateKey(date) {
  const target = new Date(date);
  const year = target.getFullYear();
  const month = String(target.getMonth() + 1).padStart(2, "0");
  const day = String(target.getDate()).padStart(2, "0");
  return year + "-" + month + "-" + day;
}

function addLocalDays(date, amount) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + amount);
  return nextDate;
}

function getWeightSamples(dailyRecords, endDate, startOffset, endOffset) {
  const samples = [];
  for (let offset = startOffset; offset <= endOffset; offset += 1) {
    const date = addLocalDays(endDate, offset);
    const key = getLocalDateKey(date);
    const morningWeight = toNumber(dailyRecords?.[key]?.morningWeight);
    if (morningWeight > 0) samples.push({ key, weight: morningWeight });
  }
  return samples;
}

function averageWeight(samples) {
  if (!samples.length) return 0;
  return samples.reduce((sum, sample) => sum + sample.weight, 0) / samples.length;
}

function getAdaptiveDecision(goalKey, weeklyChangePercent) {
  if (goalKey === "bulk") {
    if (weeklyChangePercent < 0.25) return { calorieDelta: 150, status: "increase", message: "증가 속도가 목표보다 느려 다음 목표 칼로리를 150kcal 올렸습니다." };
    if (weeklyChangePercent > 0.5) return { calorieDelta: -150, status: "decrease", message: "증가 속도가 목표보다 빨라 다음 목표 칼로리를 150kcal 낮췄습니다." };
    return { calorieDelta: 0, status: "keep", message: "증가 속도가 목표 범위 안에 있어 목표 칼로리를 유지합니다." };
  }
  if (goalKey === "lose") {
    if (weeklyChangePercent > -0.5) return { calorieDelta: -150, status: "decrease", message: "감소 속도가 목표보다 느려 다음 목표 칼로리를 150kcal 낮췄습니다." };
    if (weeklyChangePercent < -1) return { calorieDelta: 150, status: "increase", message: "감소 속도가 목표보다 빨라 다음 목표 칼로리를 150kcal 올렸습니다." };
    return { calorieDelta: 0, status: "keep", message: "감소 속도가 목표 범위 안에 있어 목표 칼로리를 유지합니다." };
  }
  if (weeklyChangePercent > 0.25) return { calorieDelta: -100, status: "decrease", message: "유지 목표보다 체중이 늘어 다음 목표 칼로리를 100kcal 낮췄습니다." };
  if (weeklyChangePercent < -0.25) return { calorieDelta: 100, status: "increase", message: "유지 목표보다 체중이 줄어 다음 목표 칼로리를 100kcal 올렸습니다." };
  return { calorieDelta: 0, status: "keep", message: "체중 변화가 유지 범위 안에 있어 목표 칼로리를 유지합니다." };
}

export function getAdaptiveCalorieCheck(plan, dailyRecords, selectedDate) {
  const goalKey = plan?.goalKey || plan?.profile?.goal || FALLBACK_PROFILE.goal;
  const endDate = selectedDate ? new Date(selectedDate) : new Date();
  const endKey = getLocalDateKey(endDate);
  if (!plan) return { status: "missing-plan", message: "목표 정보가 없어 자동 보정을 건너뜁니다.", calorieDelta: 0, endKey };
  if (plan.isManualTarget) return { status: "manual", message: "수동으로 수정한 목표라 자동 보정을 건너뜁니다.", calorieDelta: 0, endKey };
  const recentSamples = getWeightSamples(dailyRecords, endDate, -6, 0);
  const previousSamples = getWeightSamples(dailyRecords, endDate, -13, -7);
  if (recentSamples.length < 4 || previousSamples.length < 4) {
    return { status: "insufficient", message: "최근 7일과 이전 7일에 각각 공복 체중 4개 이상이 쌓이면 자동 보정합니다.", calorieDelta: 0, endKey, recentCount: recentSamples.length, previousCount: previousSamples.length };
  }
  const recentAverage = averageWeight(recentSamples);
  const previousAverage = averageWeight(previousSamples);
  const weeklyChangeKg = recentAverage - previousAverage;
  const weeklyChangePercent = previousAverage > 0 ? (weeklyChangeKg / previousAverage) * 100 : 0;
  return { ...getAdaptiveDecision(goalKey, weeklyChangePercent), endKey, goalKey, recentAverage, previousAverage, recentCount: recentSamples.length, previousCount: previousSamples.length, weeklyChangeKg, weeklyChangePercent };
}

export function applyAdaptiveCalorieCheck(plan, check) {
  if (!plan || !check) return plan;
  const adaptive = { status: check.status, message: check.message, endKey: check.endKey, recentAverage: check.recentAverage, previousAverage: check.previousAverage, weeklyChangeKg: check.weeklyChangeKg, weeklyChangePercent: check.weeklyChangePercent, calorieDelta: check.calorieDelta };
  if (plan.isManualTarget || !["increase", "decrease", "keep"].includes(check.status)) return { ...plan, adaptive };
  if (plan.lastAdjustmentEndKey && plan.lastAdjustmentEndKey === check.endKey) {
    return { ...plan, adaptive: { ...adaptive, status: "already-adjusted", message: "이미 같은 7일 구간으로 자동 보정을 반영했습니다." } };
  }
  const baseCalorieGoal = toNumber(plan.baseCalorieGoal) || Math.max(1, Math.round(toNumber(plan.calorieGoal)));
  const currentAdjustment = toNumber(plan.adjustmentKcal);
  const nextAdjustment = clamp(currentAdjustment + toNumber(check.calorieDelta), -600, 600);
  const calorieGoal = Math.max(1, baseCalorieGoal + nextAdjustment);
  const goalKey = plan.goalKey || plan.profile?.goal || FALLBACK_PROFILE.goal;
  const macroTargets = buildMacroTargets(calorieGoal, plan.profile || FALLBACK_PROFILE, goalKey);
  const adjustmentHistory = toNumber(check.calorieDelta) === 0 ? (plan.adjustmentHistory || []) : [{ endKey: check.endKey, calorieDelta: toNumber(check.calorieDelta), adjustmentKcal: nextAdjustment, calorieGoal, weeklyChangeKg: check.weeklyChangeKg, weeklyChangePercent: check.weeklyChangePercent }, ...(plan.adjustmentHistory || [])].slice(0, 12);
  return { ...plan, calorieGoal, baseCalorieGoal, adjustmentKcal: nextAdjustment, macroTargets, adaptive, adjustmentHistory, lastAdjustmentEndKey: check.endKey };
}

export function maybeApplyAdaptiveCalories(plan, dailyRecords, selectedDate) {
  const check = getAdaptiveCalorieCheck(plan, dailyRecords, selectedDate);
  return applyAdaptiveCalorieCheck(plan, check);
}

export function isRequiredProfileFilled(profile) {
  return Boolean(
    profile.sex &&
      toNumber(profile.age) > 0 &&
      toNumber(profile.height) > 0 &&
      toNumber(profile.weight) > 0 &&
      profile.jobActivity &&
      profile.goal &&
      profile.weightSessions !== "" &&
      profile.weightSessions !== undefined
  );
}

export function getActivityBySteps(value) {
  const steps = toNumber(value);
  if (steps <= 0) return "";
  if (steps <= 3000) return "sedentary";
  if (steps <= 7000) return "light";
  if (steps <= 10000) return "moderate";
  if (steps <= 15000) return "high";
  return "physical";
}

export function applyManualTargets(plan, targets) {
  const calorieGoal = Math.max(1, Math.round(toNumber(targets.calorieGoal)));
  const carb = Math.max(0, Math.round(toNumber(targets.carb)));
  const protein = Math.max(0, Math.round(toNumber(targets.protein)));
  const fat = Math.max(0, Math.round(toNumber(targets.fat)));

  return {
    ...plan,
    calorieGoal,
    macroTargets: { carb, protein, fat },
    guide: "직접 수정한 목표가 기록과 통계에 적용됩니다.",
    isManualTarget: true,
  };
}

export function calculateTotals(meals) {
  return meals.reduce(
    (total, meal) => {
      meal.items.forEach((item) => {
        if (!item.nutrients) return;
        total.kcal += item.nutrients.kcal;
        total.carb += item.nutrients.carb;
        total.protein += item.nutrients.protein;
        total.fat += item.nutrients.fat;
      });
      return total;
    },
    { kcal: 0, carb: 0, protein: 0, fat: 0 }
  );
}

export const MACRO_CALORIE_FACTORS = {
  carb: 4,
  protein: 4,
  fat: 9,
};

export function getTargetFormValues(form) {
  return {
    calorieGoal: Math.max(0, Math.round(toNumber(form.calorieGoal))),
    carb: Math.max(0, Math.round(toNumber(form.carb))),
    protein: Math.max(0, Math.round(toNumber(form.protein))),
    fat: Math.max(0, Math.round(toNumber(form.fat))),
  };
}

export function targetValuesToForm(values) {
  return {
    calorieGoal: values.calorieGoal > 0 ? String(values.calorieGoal) : "",
    carb: String(Math.max(0, Math.round(values.carb))),
    protein: String(Math.max(0, Math.round(values.protein))),
    fat: String(Math.max(0, Math.round(values.fat))),
  };
}

export function getMacroCalories(values) {
  return values.carb * 4 + values.protein * 4 + values.fat * 9;
}

export function getMacroCalorieGap(values) {
  return values.calorieGoal - getMacroCalories(values);
}

export function balanceTargetValues(values, locks, changedField = "calorieGoal") {
  const next = {
    calorieGoal: Math.max(1, Math.round(toNumber(values.calorieGoal))),
    carb: Math.max(0, Math.round(toNumber(values.carb))),
    protein: Math.max(0, Math.round(toNumber(values.protein))),
    fat: Math.max(0, Math.round(toNumber(values.fat))),
  };

  const preferredOrder = changedField === "calorieGoal"
    ? ["carb", "fat", "protein"]
    : ["carb", "fat", "protein"].filter((macro) => macro !== changedField);
  const adjustableMacro = preferredOrder.find((macro) => !locks[macro]);

  if (!adjustableMacro) return next;

  const otherCalories = getMacroCalories(next) - next[adjustableMacro] * MACRO_CALORIE_FACTORS[adjustableMacro];
  next[adjustableMacro] = Math.max(0, Math.round((next.calorieGoal - otherCalories) / MACRO_CALORIE_FACTORS[adjustableMacro]));

  return next;
}

export function cleanIntegerInput(value) {
  return String(value).replace(/\D/g, "");
}

export function getGapTone(gap) {
  const absoluteGap = Math.abs(gap);
  if (absoluteGap <= 20) return "ok";
  if (absoluteGap <= 100) return "notice";
  return "warning";
}
