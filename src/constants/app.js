export const DEFAULT_PROFILE = {
  sex: "",
  age: "",
  height: "",
  weight: "",
  bodyCompositionMode: "none",
  bodyFatValue: "",
  bodyFatUnit: "kg",
  bodyFatMass: "",
  muscleMass: "",
  steps: "",
  weightSessions: "",
  cardioSessions: "",
  cardioMinutes: "",
  jobActivity: "",
  goal: "",
};

export const FALLBACK_PROFILE = {
  sex: "male",
  age: 28,
  height: 172,
  weight: 78,
  bodyCompositionMode: "none",
  bodyFatValue: 18,
  bodyFatUnit: "percent",
  bodyFatMass: 14,
  muscleMass: 35.9,
  steps: 5000,
  weightSessions: 0,
  cardioSessions: 0,
  cardioMinutes: 30,
  jobActivity: "light",
  goal: "maintain",
};

export const GOAL_OPTIONS = {
  lose: { label: "감량", multiplier: 0.85, tone: "calm", helper: "체중 감소" },
  maintain: { label: "유지", multiplier: 1, tone: "good", helper: "현재 체중 유지" },
  bulk: { label: "벌크", multiplier: 1.1, tone: "strong", helper: "체중 증가" },
};

export const JOB_ACTIVITY_OPTIONS = [
  {
    value: "sedentary",
    label: "거의 앉아 있음",
    description: "사무직, 학생처럼 하루 대부분 앉아서 생활",
    stepsLabel: "낮은 생활 활동",
    defaultSteps: 2500,
    kcal: 0,
  },
  {
    value: "light",
    label: "가볍게 움직임",
    description: "앉아 있는 시간이 많지만 일상 이동이 약간 있음",
    stepsLabel: "가벼운 생활 활동",
    defaultSteps: 5000,
    kcal: 120,
  },
  {
    value: "moderate",
    label: "보통 활동적",
    description: "일상 이동이 많거나 서 있는 시간이 있는 편",
    stepsLabel: "보통 생활 활동",
    defaultSteps: 8500,
    kcal: 260,
  },
  {
    value: "high",
    label: "많이 움직임",
    description: "서서 일하거나 이동이 많고, 주 4~6회 운동",
    stepsLabel: "10,000 ~ 15,000보",
    defaultSteps: 12500,
    kcal: 420,
  },
  {
    value: "physical",
    label: "육체노동 수준",
    description: "무거운 물건을 들거나 강한 신체활동이 많은 직업",
    stepsLabel: "매우 높은 생활 활동",
    defaultSteps: 16000,
    kcal: 620,
  },
];

export const BASE_FOOD_DB = [];

export const BUILT_IN_FOOD_ALIASES = [];

export const MEMO_EXAMPLE_ROWS = [
  { time: "06:30", foods: "밥 200g, 닭가슴살 270g" },
  { time: "12:30", foods: "밥 250g, 닭가슴살 200g" },
  { time: "18:30", foods: "고구마 250g, 계란 3개" },
];
