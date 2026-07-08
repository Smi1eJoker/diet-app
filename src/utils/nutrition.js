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
  const rawBodyFatValue = toNumber(profile.bodyFatValue ?? profile.bodyFatMass);
  const bodyFatRate = bodyFatUnit === "percent"
    ? clamp(rawBodyFatValue || FALLBACK_PROFILE.bodyFatValue, 0, 70)
    : weight > 0
      ? (clamp(rawBodyFatValue || FALLBACK_PROFILE.bodyFatMass, 0, weight * 0.7) / weight) * 100
      : 0;
  const bodyFatMass = bodyFatUnit === "percent"
    ? weight * (bodyFatRate / 100)
    : clamp(rawBodyFatValue || FALLBACK_PROFILE.bodyFatMass, 0, weight * 0.7);

  return {
    ...profile,
    age: clamp(toNumber(profile.age) || FALLBACK_PROFILE.age, 14, 90),
    height: clamp(toNumber(profile.height) || FALLBACK_PROFILE.height, 120, 230),
    weight,
    bodyFatValue: rawBodyFatValue || FALLBACK_PROFILE.bodyFatValue,
    bodyFatUnit,
    bodyFatMass,
    bodyFatRate,
    muscleMass: clamp(toNumber(profile.muscleMass) || FALLBACK_PROFILE.muscleMass, 10, 70),
    steps: clamp(toNumber(profile.steps), 0, 40000),
    weightSessions: clamp(toNumber(profile.weightSessions), 0, 14),
    cardioSessions: clamp(toNumber(profile.cardioSessions), 0, 14),
    cardioMinutes: clamp(toNumber(profile.cardioMinutes), 0, 300),
  };
}

export function buildNutritionPlan(profile) {
  const data = getNumericProfile(profile);
  const goal = GOAL_OPTIONS[data.goal || FALLBACK_PROFILE.goal] || GOAL_OPTIONS.maintain;
  const job = JOB_ACTIVITY_OPTIONS.find((option) => option.value === (data.jobActivity || FALLBACK_PROFILE.jobActivity)) || JOB_ACTIVITY_OPTIONS[1];
  const leanMass = clamp(data.weight - data.bodyFatMass, data.weight * 0.35, data.weight);
  const bmr = Math.round(370 + 21.6 * leanMass);
  const effectiveSteps = data.steps > 0 ? data.steps : job.defaultSteps;
  const stepCalories = Math.round(effectiveSteps * data.weight * 0.0005);
  const weightCalories = Math.round((data.weight * 5 * 0.75 * data.weightSessions) / 7);
  const cardioCalories = Math.round((data.weight * 7 * (data.cardioSessions * data.cardioMinutes / 60)) / 7);
  const activityCalories = stepCalories + weightCalories + cardioCalories + job.kcal;
  const tef = Math.round((bmr + activityCalories) * 0.1);
  const tdee = Math.round(bmr + activityCalories + tef);
  const calorieGoal = Math.round((tdee * goal.multiplier) / 10) * 10;
  const protein = Math.round(data.weight * 1.9);
  const fat = Math.max(35, Math.round((calorieGoal * 0.22) / 9));
  const carb = Math.max(0, Math.round((calorieGoal - protein * 4 - fat * 9) / 4));
  const bodyFatRate = data.bodyFatRate;

  return {
    profile: data,
    goalKey: data.goal || FALLBACK_PROFILE.goal,
    goalLabel: goal.label,
    calorieGoal,
    macroTargets: { carb, protein, fat },
    details: {
      bmr,
      leanMass,
      bodyFatRate,
      stepCalories,
      weightCalories,
      cardioCalories,
      jobCalories: job.kcal,
      effectiveSteps,
      activityCalories,
      tef,
      tdee,
    },
    guide:
      goal.label === "벌크"
        ? "2주 평균 체중 변화를 보고 목표를 조절하세요."
        : goal.label === "감량"
          ? "컨디션이 떨어지면 5% 단위로 목표를 조절하세요."
          : "운동량이 바뀌면 목표를 다시 계산하세요.",
  };
}

export function isRequiredProfileFilled(profile) {
  return Boolean(
    profile.sex &&
      toNumber(profile.age) > 0 &&
      toNumber(profile.height) > 0 &&
      toNumber(profile.weight) > 0 &&
      profile.jobActivity &&
      profile.goal
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
