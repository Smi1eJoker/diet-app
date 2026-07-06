import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "";
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || "";
const HAS_SUPABASE_CONFIG = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
const SUPABASE_AUTH_STORAGE_KEY = "diet-app-supabase-session";

const DEFAULT_PROFILE = {
  sex: "",
  age: "",
  height: "",
  weight: "",
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

const FALLBACK_PROFILE = {
  sex: "male",
  age: 28,
  height: 172,
  weight: 78,
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

const GOAL_OPTIONS = {
  lose: { label: "감량", multiplier: 0.85, tone: "calm", helper: "체중 감소" },
  maintain: { label: "유지", multiplier: 1, tone: "good", helper: "현재 체중 유지" },
  bulk: { label: "벌크", multiplier: 1.1, tone: "strong", helper: "체중 증가" },
};

const JOB_ACTIVITY_OPTIONS = [
  {
    value: "sedentary",
    label: "거의 앉아 있음",
    description: "하루 대부분 앉아서 생활, 운동 거의 없음",
    stepsLabel: "3,000보 이하",
    defaultSteps: 2500,
    kcal: 0,
  },
  {
    value: "light",
    label: "가볍게 움직임",
    description: "가벼운 이동이 있는 생활, 가벼운 운동 포함",
    stepsLabel: "3,000 ~ 7,000보",
    defaultSteps: 5000,
    kcal: 120,
  },
  {
    value: "moderate",
    label: "보통 활동적",
    description: "일상 이동이 많은 편, 주 3~4회 운동",
    stepsLabel: "7,000 ~ 10,000보",
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
    description: "무거운 작업이 포함된 활동, 매우 높은 활동량",
    stepsLabel: "15,000보 이상",
    defaultSteps: 16000,
    kcal: 620,
  },
];

const BASE_FOOD_DB = [];
const BUILT_IN_FOOD_ALIASES = [];

const MEMO_EXAMPLE_ROWS = [
  { time: "06:30", foods: "밥 200g, 닭가슴살 270g" },
  { time: "12:30", foods: "밥 250g, 닭가슴살 200g" },
  { time: "18:30", foods: "고구마 250g, 계란 3개" },
];


function loadStoredSession() {
  try {
    const raw = window.localStorage.getItem(SUPABASE_AUTH_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveStoredSession(session) {
  if (!session) {
    window.localStorage.removeItem(SUPABASE_AUTH_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(SUPABASE_AUTH_STORAGE_KEY, JSON.stringify(session));
}

async function requestSupabaseAuth(path, body, accessToken) {
  const response = await fetch(SUPABASE_URL + path, {
    method: "POST",
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: "Bearer " + (accessToken || SUPABASE_PUBLISHABLE_KEY),
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error_description || data.msg || data.message || "요청을 처리하지 못했어.");
  }
  return data;
}

async function signInWithEmail(email, password) {
  return requestSupabaseAuth("/auth/v1/token?grant_type=password", { email, password });
}

async function signUpWithEmail(email, password) {
  return requestSupabaseAuth("/auth/v1/signup", { email, password });
}

async function refreshSupabaseSession(refreshToken) {
  if (!refreshToken) throw new Error("저장된 로그인 정보를 확인하지 못했어.");
  return requestSupabaseAuth("/auth/v1/token?grant_type=refresh_token", { refresh_token: refreshToken });
}

function getSessionExpiresAtMs(session) {
  if (session?.expires_at) return Number(session.expires_at) * 1000;
  if (session?.expires_in) return Date.now() + Number(session.expires_in) * 1000;
  return 0;
}

function isSessionExpiringSoon(session, bufferMs = 60 * 1000) {
  const expiresAtMs = getSessionExpiresAtMs(session);
  if (!expiresAtMs) return false;
  return expiresAtMs - Date.now() <= bufferMs;
}

function mergeAuthSession(currentSession, nextSession) {
  if (!nextSession?.access_token) return currentSession;
  return {
    ...currentSession,
    ...nextSession,
    user: nextSession.user || currentSession?.user || null,
  };
}

async function signOutFromSupabase(session) {
  if (!session?.access_token) return;
  await requestSupabaseAuth("/auth/v1/logout", {}, session.access_token);
}


async function requestSupabaseRest(path, options = {}, accessToken) {
  if (!HAS_SUPABASE_CONFIG) {
    throw new Error("Supabase 설정이 없어.");
  }

  const response = await fetch(SUPABASE_URL + "/rest/v1" + path, {
    method: options.method || "GET",
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: "Bearer " + (accessToken || SUPABASE_PUBLISHABLE_KEY),
      "Content-Type": "application/json",
      ...(options.prefer ? { Prefer: options.prefer } : {}),
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message = data?.message || data?.msg || data?.error_description || "Supabase DB 요청에 실패했어.";
    throw new Error(message);
  }

  return data;
}

function getSessionUserId(session) {
  return session?.user?.id || session?.user_id || session?.sub || null;
}

function isJwtExpiredError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return message.includes("jwt expired") || message.includes("token is expired");
}

function toFoodEntry(row, fallbackId) {
  const raw = row.raw_foods || row.raw_food || {};
  const isAppFood = row.display_name || row.app_food_id;
  const isUserFood = row.food_name || row.user_food_id;
  const displayName = isAppFood ? row.display_name : row.food_name;
  const foodName = cleanFoodName(displayName || row.raw_name || row.name || "");

  return {
    id: isAppFood
      ? "app-" + row.app_food_id
      : isUserFood
        ? "user-" + row.user_food_id
        : row.id || fallbackId || "food-" + normalize(foodName),
    appFoodId: row.app_food_id || null,
    userFoodId: row.user_food_id || null,
    rawFoodId: row.raw_food_id || raw.raw_food_id || null,
    name: foodName,
    normalizedName: normalize(foodName),
    kcal: toNumber(raw.kcal_per_100g ?? row.kcal_per_100g ?? row.kcal),
    carb: toNumber(raw.carb_g_per_100g ?? row.carb_g_per_100g ?? row.carb_g ?? row.carb),
    protein: toNumber(raw.protein_g_per_100g ?? row.protein_g_per_100g ?? row.protein_g ?? row.protein),
    fat: toNumber(raw.fat_g_per_100g ?? row.fat_g_per_100g ?? row.fat_g ?? row.fat),
    category: row.category || row.food_group || "",
    defaultUnit: row.default_unit || row.base_unit || "g",
    defaultAmount: toNumber(row.default_amount ?? row.base_amount) || 100,
    rawName: raw.raw_name || row.raw_name || foodName,
    searchPriority: toNumber(row.search_priority),
    searchTerms: [],
    source: isUserFood ? "user_food" : "supabase",
  };
}

function buildFoodMap(appFoods = [], userAliases = [], userFoods = [], foodSearchTerms = [], foodUnits = []) {
  const nextMap = {};
  const appFoodsById = {};
  const userFoodsById = {};
  const unitsByAppFoodId = {};

  foodUnits.forEach((row) => {
    if (!row.app_food_id) return;
    const key = String(row.app_food_id);
    const unit = {
      unitId: row.unit_id || null,
      unitName: cleanFoodName(row.unit_name || ""),
      grams: toNumber(row.grams),
      isDefault: Boolean(row.is_default),
      aliases: Array.isArray(row.aliases) ? row.aliases.map(cleanFoodName).filter(Boolean) : [],
    };

    if (!unit.unitName || unit.grams <= 0) return;
    unitsByAppFoodId[key] = [...(unitsByAppFoodId[key] || []), unit];
  });

  appFoods.forEach((row) => {
    const food = toFoodEntry(row);
    if (!food.name) return;
    const foodWithUnits = {
      ...food,
      units: food.appFoodId ? (unitsByAppFoodId[String(food.appFoodId)] || []) : [],
    };
    nextMap[normalize(foodWithUnits.name)] = foodWithUnits;
    if (foodWithUnits.appFoodId) appFoodsById[String(foodWithUnits.appFoodId)] = foodWithUnits;
  });

  userFoods.forEach((row) => {
    const food = toFoodEntry(row, "user-" + normalize(row.food_name));
    if (!food.name) return;
    nextMap[normalize(food.name)] = food;
    if (food.userFoodId) userFoodsById[String(food.userFoodId)] = food;
  });

  // 후보 추천 전용 검색어다. 자동 계산에는 쓰지 않는다.
  // food_search_terms 테이블이 있으면 여기서 "가슴살 -> 닭고기(가슴, 생것)" 같은 추천 품질을 올릴 수 있다.
  foodSearchTerms.forEach((term) => {
    const canonical = term.app_food_id
      ? appFoodsById[String(term.app_food_id)]
      : term.user_food_id
        ? userFoodsById[String(term.user_food_id)]
        : null;

    if (!canonical || !term.term_text) return;

    canonical.searchTerms = [
      ...(canonical.searchTerms || []),
      {
        text: cleanFoodName(term.term_text),
        normalized: normalize(term.term_norm || term.term_text),
        weight: toNumber(term.weight) || 50,
      },
    ];
  });

  userAliases.forEach((alias) => {
    const canonical = alias.app_food_id
      ? appFoodsById[String(alias.app_food_id)]
      : alias.user_food_id
        ? userFoodsById[String(alias.user_food_id)]
        : null;

    if (!canonical || !alias.alias_text) return;
    const aliasName = cleanFoodName(alias.alias_text);
    const aliasKey = normalize(aliasName);
    nextMap[aliasKey] = {
      ...canonical,
      id: "alias-" + (alias.alias_id || aliasKey),
      name: aliasName,
      canonicalName: canonical.name,
      source: "user_alias",
    };
  });

  return nextMap;
}

async function fetchFoodDatabase(session) {
  const accessToken = session?.access_token;
  const userId = getSessionUserId(session);

  const appFoodsPath = "/app_foods?select=app_food_id,display_name,raw_food_id,category,default_unit,default_amount,search_priority,raw_foods(raw_food_id,raw_name,kcal_per_100g,carb_g_per_100g,protein_g_per_100g,fat_g_per_100g)&order=search_priority.desc,display_name.asc";
  const foodSearchTermsPath = "/food_search_terms?select=term_id,term_text,term_norm,app_food_id,weight&order=weight.desc,term_text.asc";
  const foodUnitsPath = "/food_units?select=unit_id,app_food_id,unit_name,grams,is_default,aliases&order=app_food_id.asc,unit_name.asc";

  // 기본 음식 DB는 사용자 로그인 토큰이 아니라 anon/publishable key로 불러온다.
  // 저장된 로그인 토큰이 만료되어도 app_foods/raw_foods는 계속 매칭되어야 한다.
  const appFoodsPromise = requestSupabaseRest(appFoodsPath, {}, null);

  // food_search_terms는 후보 추천 품질을 올리는 선택 테이블이다.
  // 아직 테이블을 만들지 않았거나 권한이 없어도 앱 본체는 그대로 동작해야 한다.
  const foodSearchTermsPromise = requestSupabaseRest(foodSearchTermsPath, {}, null).catch(() => []);
  const foodUnitsPromise = requestSupabaseRest(foodUnitsPath, {}, null).catch(() => []);

  const safeUserRequest = (promise) =>
    promise.catch((error) => {
      if (isJwtExpiredError(error)) return [];
      throw error;
    });

  const userAliasesPromise = userId && accessToken
    ? safeUserRequest(requestSupabaseRest("/user_aliases?select=alias_id,alias_text,app_food_id,user_food_id&user_id=eq." + encodeURIComponent(userId), {}, accessToken))
    : Promise.resolve([]);
  const userFoodsPromise = userId && accessToken
    ? safeUserRequest(requestSupabaseRest("/user_foods?select=*&user_id=eq." + encodeURIComponent(userId), {}, accessToken))
    : Promise.resolve([]);

  const [appFoods, userAliases, userFoods, foodSearchTerms, foodUnits] = await Promise.all([
    appFoodsPromise,
    userAliasesPromise,
    userFoodsPromise,
    foodSearchTermsPromise,
    foodUnitsPromise,
  ]);

  return buildFoodMap(appFoods || [], userAliases || [], userFoods || [], foodSearchTerms || [], foodUnits || []);
}

async function upsertUserFood(session, food) {
  const userId = getSessionUserId(session);
  if (!userId) throw new Error("사용자 정보를 확인하지 못했어.");

  const payload = {
    user_id: userId,
    food_name: cleanFoodName(food.name || food.food_name),
    base_amount: toNumber(food.base_amount ?? food.base_amount_g) || 100,
    base_unit: food.base_unit || "g",
    kcal: toNumber(food.kcal),
    carb_g: toNumber(food.carb_g ?? food.carb),
    protein_g: toNumber(food.protein_g ?? food.protein),
    fat_g: toNumber(food.fat_g ?? food.fat),
  };

  const rows = await requestSupabaseRest(
    "/user_foods?on_conflict=user_id,food_name_norm",
    {
      method: "POST",
      body: payload,
      prefer: "resolution=merge-duplicates,return=representation",
    },
    session?.access_token
  );

  return Array.isArray(rows) && rows[0] ? rows[0] : payload;
}

async function upsertUserAlias(session, aliasText, food) {
  const userId = getSessionUserId(session);
  if (!userId) throw new Error("사용자 정보를 확인하지 못했어.");

  const appFoodId = food.appFoodId || food.app_food_id || null;
  const userFoodId = food.userFoodId || food.user_food_id || null;
  if (!appFoodId && !userFoodId) throw new Error("연결할 음식 ID를 확인하지 못했어.");

  const payload = {
    user_id: userId,
    alias_text: cleanFoodName(aliasText),
    app_food_id: appFoodId,
    user_food_id: userFoodId,
  };

  const rows = await requestSupabaseRest(
    "/user_aliases?on_conflict=user_id,alias_norm",
    {
      method: "POST",
      body: payload,
      prefer: "resolution=merge-duplicates,return=representation",
    },
    session?.access_token
  );

  return Array.isArray(rows) && rows[0] ? rows[0] : payload;
}


async function fetchUserAppState(session) {
  const userId = getSessionUserId(session);
  const accessToken = session?.access_token;
  if (!userId || !accessToken) return null;

  const rows = await requestSupabaseRest(
    "/user_app_state?select=profile,nutrition_plan,setup_screen&user_id=eq." + encodeURIComponent(userId),
    {},
    accessToken
  );

  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

async function upsertUserAppState(session, state) {
  const userId = getSessionUserId(session);
  if (!userId) throw new Error("사용자 정보를 확인하지 못했어.");

  const payload = {
    user_id: userId,
    profile: state.profile || {},
    nutrition_plan: state.nutritionPlan || {},
    setup_screen: state.setupScreen || "setup",
    updated_at: new Date().toISOString(),
  };

  const rows = await requestSupabaseRest(
    "/user_app_state?on_conflict=user_id",
    {
      method: "POST",
      body: payload,
      prefer: "resolution=merge-duplicates,return=representation",
    },
    session?.access_token
  );

  return Array.isArray(rows) && rows[0] ? rows[0] : payload;
}

async function fetchUserDailyLogs(session) {
  const userId = getSessionUserId(session);
  const accessToken = session?.access_token;
  if (!userId || !accessToken) return { mealsByDate: {}, dailyRecords: {} };

  const rows = await requestSupabaseRest(
    "/user_daily_logs?select=date_key,meals,daily_record&user_id=eq." + encodeURIComponent(userId) + "&order=date_key.asc",
    {},
    accessToken
  );

  return (rows || []).reduce(
    (acc, row) => {
      const key = row.date_key;
      if (!key) return acc;
      acc.mealsByDate[key] = Array.isArray(row.meals)
        ? row.meals.map((meal) => ({ ...meal, isOpen: false }))
        : [];
      acc.dailyRecords[key] = row.daily_record || {};
      return acc;
    },
    { mealsByDate: {}, dailyRecords: {} }
  );
}

async function upsertUserDailyLog(session, dateKey, meals, dailyRecord) {
  const userId = getSessionUserId(session);
  if (!userId) throw new Error("사용자 정보를 확인하지 못했어.");

  const payload = {
    user_id: userId,
    date_key: dateKey,
    meals: meals || [],
    daily_record: dailyRecord || {},
    updated_at: new Date().toISOString(),
  };

  const rows = await requestSupabaseRest(
    "/user_daily_logs?on_conflict=user_id,date_key",
    {
      method: "POST",
      body: payload,
      prefer: "resolution=merge-duplicates,return=representation",
    },
    session?.access_token
  );

  return Array.isArray(rows) && rows[0] ? rows[0] : payload;
}

function getDateKey(date) {
  const target = new Date(date);
  const year = target.getFullYear();
  const month = String(target.getMonth() + 1).padStart(2, "0");
  const day = String(target.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function formatChartDateLabel(date, selectedDate) {
  if (isSameDate(date, selectedDate)) return "오늘";

  const month = date.getMonth() + 1;
  const day = date.getDate();

  return `${month}/${day}`;
}

function formatTooltipDateLabel(date) {
  const month = date.getMonth() + 1;
  const day = date.getDate();

  return `${month}월 ${day}일`;
}

function buildDatePoints(anchorDate, days = 7) {
  const points = [];

  for (let offset = -(days - 1); offset <= 0; offset += 1) {
    const date = addDays(anchorDate, offset);

    points.push({
      key: getDateKey(date),
      label: formatChartDateLabel(date, anchorDate),
      tooltipLabel: formatTooltipDateLabel(date),
    });
  }

  return points;
}

function parseDateKey(key) {
  const [year, month, day] = String(key).split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function getLatestRecordDate(records, predicate) {
  return Object.entries(records)
    .filter(([, record]) => predicate(record))
    .map(([key]) => parseDateKey(key))
    .filter(Boolean)
    .sort((a, b) => a - b)
    .at(-1) || null;
}

function getChartAnchorDate(records) {
  const today = new Date();
  const latestCompletedDate = getLatestRecordDate(records, (record) => Boolean(record?.dayComplete));
  const latestWeightDate = getLatestRecordDate(records, (record) => toNumber(record?.morningWeight) > 0);

  return [today, latestCompletedDate, latestWeightDate]
    .filter(Boolean)
    .sort((a, b) => a - b)
    .at(-1);
}

function buildStats(meals, plan, morningWeight, dailyRecords, selectedDate) {
  const totals = calculateTotals(meals);
  const selectedKey = getDateKey(selectedDate);
  const selectedRecord = dailyRecords[selectedKey] || {};
  const records = {
    ...dailyRecords,
    [selectedKey]: {
      ...selectedRecord,
      kcal: Math.round(totals.kcal),
      carb: totals.carb,
      protein: totals.protein,
      fat: totals.fat,
      morningWeight: toNumber(morningWeight) || selectedRecord.morningWeight || 0,
    },
  };
  const macroTotal = totals.carb + totals.protein + totals.fat;

  const chartAnchorDate = getChartAnchorDate(records);

  const makeWeightTrend = (range) => {
    const days = range === "30" ? 30 : 7;
    return buildDatePoints(chartAnchorDate, days)
      .map((point) => ({ ...point, weight: toNumber(records[point.key]?.morningWeight) }))
      .filter((point) => point.weight > 0);
  };

  const makeCalorieTrend = (range) => {
    const days = range === "30" ? 30 : 7;
    return buildDatePoints(chartAnchorDate, days)
      .map((point) => {
        const record = records[point.key] || {};
        return {
          ...point,
          kcal: record.dayComplete ? toNumber(record.kcal) : 0,
        };
      })
      .filter((point) => point.kcal > 0);
  };

  return {
    totals,
    currentKcal: Math.round(totals.kcal),
    makeWeightTrend,
    makeCalorieTrend,
    macroRates: {
      carb: macroTotal > 0 ? Math.round((totals.carb / macroTotal) * 100) : 0,
      protein: macroTotal > 0 ? Math.round((totals.protein / macroTotal) * 100) : 0,
      fat: macroTotal > 0 ? Math.round((totals.fat / macroTotal) * 100) : 0,
    },
  };
}

function addDays(date, amount) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + amount);
  return nextDate;
}

function isSameDate(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function normalize(value) {
  return String(value || "")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^0-9a-z가-힣]+/g, "");
}

function addUniqueToken(tokens, token) {
  if (token && !tokens.includes(token)) tokens.push(token);
}

function getFoodSearchTokens(value) {
  const text = normalize(value);
  if (!text) return [];

  const tokens = [];
  const add = (token) => addUniqueToken(tokens, token);

  // 후보 추천 전용 토큰이다. 자동 계산에는 절대 사용하지 않는다.
  // 한 글자 전체 검색은 너무 넓기 때문에, "닭" 단독 검색 같은 경우는 아래 점수 함수에서 걸러낸다.
  const rules = [
    { token: "닭", patterns: ["닭고기", "닭가슴", "닭안심", "닭다리", "닭날개", "닭찌", "치킨"] },
    { token: "소", patterns: ["소고기", "쇠고기", "한우", "우둔", "양지", "채끝"] },
    { token: "돼지", patterns: ["돼지고기", "삼겹", "목살", "앞다리", "뒷다리", "항정", "가브리"] },
    { token: "오리", patterns: ["오리"] },

    { token: "가슴", patterns: ["가슴살", "가슴"] },
    { token: "안심", patterns: ["안심"] },
    { token: "등심", patterns: ["등심"] },
    { token: "목살", patterns: ["목살", "목심"] },
    { token: "삼겹", patterns: ["삼겹"] },
    { token: "갈비", patterns: ["갈비"] },
    { token: "사태", patterns: ["사태"] },
    { token: "양지", patterns: ["양지"] },
    { token: "채끝", patterns: ["채끝"] },
    { token: "다리", patterns: ["다리", "허벅"] },
    { token: "날개", patterns: ["날개", "윙", "봉"] },

    { token: "생것", patterns: ["생것", "생"] },
    { token: "구운", patterns: ["구운", "구이", "구웠", "팬", "석쇠", "오븐"] },
    { token: "삶은", patterns: ["삶", "삶은", "수육"] },
    { token: "볶은", patterns: ["볶", "볶은"] },
    { token: "튀긴", patterns: ["튀김", "튀긴", "프라이드"] },

    { token: "밥", patterns: ["밥", "공기밥", "쌀밥"] },
    { token: "백미", patterns: ["백미", "쌀밥", "공기밥"] },
    { token: "현미", patterns: ["현미"] },
    { token: "귀리", patterns: ["귀리"] },
    { token: "보리", patterns: ["보리"] },
    { token: "잡곡", patterns: ["잡곡", "혼합곡"] },
    { token: "흑미", patterns: ["흑미"] },

    { token: "계란", patterns: ["계란", "달걀"] },
    { token: "고구마", patterns: ["고구마"] },
    { token: "감자", patterns: ["감자"] },
  ];

  rules.forEach((rule) => {
    if (rule.patterns.some((pattern) => text.includes(normalize(pattern)))) add(rule.token);
  });

  // 한국어 식단 입력에서 "가슴살"은 대부분 닭가슴살 의미로 쓰이므로 후보 추천에서만 닭+가슴으로 해석한다.
  // 자동 계산은 여전히 사용자가 직접 연결한 user_aliases가 있어야만 된다.
  if (text.includes("닭찌")) {
    add("닭");
    add("가슴");
  }

  if (text.includes("가슴살") && !tokens.includes("닭") && !tokens.includes("소") && !tokens.includes("돼지") && !tokens.includes("오리")) {
    add("닭");
  }

  if (text.includes("목살") && !tokens.includes("돼지") && !tokens.includes("소")) {
    add("돼지");
  }

  if (text.includes("등심") && !tokens.includes("소") && !tokens.includes("돼지")) {
    add("소");
  }

  return tokens;
}

function cleanFoodName(value) {
  return String(value).replace(/\s/g, "").trim();
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function makeId(prefix) {
  return prefix + "-" + Date.now() + "-" + Math.random().toString(16).slice(2);
}

function formatMacro(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatAmount(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}


function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getNumericProfile(profile) {
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

function buildNutritionPlan(profile) {
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


function isRequiredProfileFilled(profile) {
  return Boolean(
    profile.sex &&
      toNumber(profile.age) > 0 &&
      toNumber(profile.height) > 0 &&
      toNumber(profile.weight) > 0 &&
      profile.jobActivity &&
      profile.goal
  );
}

function getActivityBySteps(value) {
  const steps = toNumber(value);
  if (steps <= 0) return "";
  if (steps <= 3000) return "sedentary";
  if (steps <= 7000) return "light";
  if (steps <= 10000) return "moderate";
  if (steps <= 15000) return "high";
  return "physical";
}

function applyManualTargets(plan, targets) {
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

function getBuiltInAliasFoods() {
  return [];
}

function getFoodPool(customFoods) {
  return Object.values(customFoods || {});
}

function getFoodDisplayName(food) {
  return cleanFoodName(food?.canonicalName || food?.name || "");
}

function getFoodMatchKey(food) {
  return normalize(food?.canonicalName || food?.normalizedName || food?.name || "");
}

function getFoodExactKeys(food) {
  return [
    food?.name,
    food?.canonicalName,
    food?.normalizedName,
    getFoodDisplayName(food),
  ]
    .map((value) => normalize(value || ""))
    .filter(Boolean);
}

function findExactFoodByName(name, customFoods) {
  const normalizedName = normalize(cleanFoodName(name));
  if (!normalizedName) return null;

  // 자동 계산은 user_aliases/app_foods/user_foods에 정확히 존재하는 key만 허용한다.
  const directFood = customFoods?.[normalizedName];
  if (directFood) {
    return {
      ...directFood,
      displayName: getFoodDisplayName(directFood),
    };
  }

  const exactFood = getFoodPool(customFoods).find((food) =>
    getFoodExactKeys(food).includes(normalizedName)
  );

  return exactFood
    ? {
        ...exactFood,
        displayName: getFoodDisplayName(exactFood),
      }
    : null;
}

function getFoodSearchTermEntries(food) {
  return (food?.searchTerms || [])
    .map((term) => ({
      ...term,
      normalized: normalize(term.normalized || term.text || ""),
      weight: toNumber(term.weight) || 50,
    }))
    .filter((term) => term.normalized);
}

function getFoodSearchableNames(food) {
  return [
    food?.name,
    food?.canonicalName,
    food?.normalizedName,
    getFoodDisplayName(food),
    food?.rawName,
  ]
    .map((value) => normalize(value || ""))
    .filter(Boolean);
}

function isLooseFoodSearchAllowed(normalizedName) {
  // 한 글자 includes는 후보가 너무 많이 뜬다. 단, "밥"은 식단 앱에서 의미가 명확해서 예외로 둔다.
  return normalizedName.length >= 2 || normalizedName === "밥";
}

function getFoodMatchInfo(food, normalizedName) {
  const searchableNames = getFoodSearchableNames(food);
  const searchTerms = getFoodSearchTermEntries(food);
  const searchTermNames = searchTerms.map((term) => term.normalized);
  const allSearchableNames = [...searchableNames, ...searchTermNames].filter(Boolean);

  if (searchableNames.includes(normalizedName)) {
    return { score: 0, weight: 1000, reason: "exact-name" };
  }

  const exactTerm = searchTerms.find((term) => term.normalized === normalizedName);
  if (exactTerm) {
    return { score: 1, weight: exactTerm.weight + 500, reason: "search-term-exact" };
  }

  const allowLooseSearch = isLooseFoodSearchAllowed(normalizedName);

  if (allowLooseSearch && searchableNames.some((name) => name.startsWith(normalizedName))) {
    return { score: 10, weight: 200, reason: "name-starts-with" };
  }

  const startsWithTerm = searchTerms.find((term) => term.normalized.startsWith(normalizedName));
  if (allowLooseSearch && startsWithTerm) {
    return { score: 12, weight: startsWithTerm.weight + 150, reason: "search-term-starts-with" };
  }

  if (allowLooseSearch && searchableNames.some((name) => name.includes(normalizedName))) {
    return { score: 20, weight: 120, reason: "name-includes" };
  }

  const includesTerm = searchTerms.find((term) => term.normalized.includes(normalizedName));
  if (allowLooseSearch && includesTerm) {
    return { score: 22, weight: includesTerm.weight + 100, reason: "search-term-includes" };
  }

  if (allowLooseSearch && searchableNames.some((name) => normalizedName.includes(name) && name.length >= 2)) {
    return { score: 30, weight: 80, reason: "query-includes-name" };
  }

  const queryTokens = getFoodSearchTokens(normalizedName);
  const meaningfulTokens = queryTokens.filter((token) => token.length >= 2 || queryTokens.length >= 2);

  if (meaningfulTokens.length > 0) {
    const matchedTokens = meaningfulTokens.filter((token) =>
      allSearchableNames.some((name) => name.includes(normalize(token)))
    );

    // 토큰 2개 이상이 맞으면 꽤 강한 후보로 본다. 예: 가슴살 -> 닭 + 가슴.
    if (meaningfulTokens.length >= 2 && matchedTokens.length >= 2) {
      return {
        score: 40 + Math.max(0, meaningfulTokens.length - matchedTokens.length),
        weight: matchedTokens.length * 35,
        reason: "token-combo",
      };
    }

    // 한 개 토큰만으로는 너무 넓어질 수 있으므로 검색어가 3글자 이상일 때만 낮은 우선순위로 보여준다.
    if (normalizedName.length >= 3 && matchedTokens.length === meaningfulTokens.length && meaningfulTokens.every((token) => token.length >= 2)) {
      return {
        score: 55,
        weight: matchedTokens.length * 20,
        reason: "single-token",
      };
    }
  }

  return null;
}

function dedupeFoodMatches(matches) {
  const seen = new Set();
  const deduped = [];

  matches.forEach((food) => {
    const key = getFoodMatchKey(food);
    if (!key || seen.has(key)) return;
    seen.add(key);
    deduped.push({
      ...food,
      displayName: getFoodDisplayName(food),
    });
  });

  return deduped;
}

function findFoodMatches(name, customFoods) {
  const normalizedName = normalize(name);
  if (!normalizedName) return [];

  const matches = getFoodPool(customFoods)
    .map((food) => {
      const match = getFoodMatchInfo(food, normalizedName);
      return match
        ? {
            ...food,
            matchScore: match.score,
            matchWeight: match.weight,
            matchReason: match.reason,
          }
        : null;
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.matchScore !== b.matchScore) return a.matchScore - b.matchScore;
      if (a.matchWeight !== b.matchWeight) return b.matchWeight - a.matchWeight;

      const aPriority = toNumber(a.searchPriority);
      const bPriority = toNumber(b.searchPriority);
      if (aPriority !== bPriority) return bPriority - aPriority;

      const aDisplay = normalize(getFoodDisplayName(a));
      const bDisplay = normalize(getFoodDisplayName(b));
      return aDisplay.length - bDisplay.length;
    });

  return dedupeFoodMatches(matches);
}

function findFoodByName(name, customFoods) {
  return findExactFoodByName(name, customFoods);
}

function applyFoodBasisToItem(item, food) {
  const amount = toNumber(item.amount);
  const nutrients = food && amount > 0
    ? {
        kcal: food.kcal * (amount / 100),
        carb: food.carb * (amount / 100),
        protein: food.protein * (amount / 100),
        fat: food.fat * (amount / 100),
      }
    : null;

  return {
    ...item,
    name: cleanFoodName(item.name),
    amount,
    foodId: food?.id || null,
    matchedFoodName: food ? getFoodDisplayName(food) : "",
    matchedFoodSource: food?.source || "manual_basis",
    per100: food
      ? {
          kcal: food.kcal,
          carb: food.carb,
          protein: food.protein,
          fat: food.fat,
        }
      : null,
    nutrients,
  };
}

function getFoodBasisSnapshotFromItem(item) {
  if (!item?.per100) return null;

  const basisName = cleanFoodName(item.matchedFoodName || item.name);
  if (!basisName) return null;

  return {
    id: item.foodId || "basis-" + normalize(basisName),
    name: basisName,
    canonicalName: basisName,
    kcal: toNumber(item.per100.kcal),
    carb: toNumber(item.per100.carb),
    protein: toNumber(item.per100.protein),
    fat: toNumber(item.per100.fat),
    source: item.matchedFoodSource || "current_basis",
    displayName: basisName,
    isCurrentBasis: true,
  };
}

function buildMemoBasisMapFromMeals(meals) {
  const basisMap = {};

  meals.forEach((meal, rowIndex) => {
    meal.items.forEach((item, itemIndex) => {
      const basisFood = getFoodBasisSnapshotFromItem(item);
      if (!basisFood) return;
      if (normalize(item.name) === normalize(getFoodDisplayName(basisFood))) return;

      basisMap[getMemoBasisKey(rowIndex, itemIndex, 0)] = {
        aliasName: item.name,
        food: basisFood,
      };
    });
  });

  return basisMap;
}

function resolveItem(item, customFoods) {
  const food = findFoodByName(item.name, customFoods);
  return applyFoodBasisToItem(item, food);
}

function getMemoBasisKey(rowIndex, segmentIndex, entryIndex = 0) {
  return [rowIndex, segmentIndex, entryIndex].join(":");
}

function getMemoSegmentIndex(foods, cursor) {
  return String(foods || "")
    .slice(0, Math.max(0, cursor))
    .split(/[，,]/).length - 1;
}

function getMemoFoodBasis(basisMap, rowIndex, segmentIndex, entryIndex, name) {
  const candidates = [
    getMemoBasisKey(rowIndex, segmentIndex, entryIndex),
    getMemoBasisKey(rowIndex, segmentIndex, 0),
    rowIndex + ":" + segmentIndex,
  ];

  const normalizedName = normalize(name);
  const basis = candidates.map((key) => basisMap?.[key]).find(Boolean);
  if (!basis?.food) return null;
  if (basis.aliasName && normalize(basis.aliasName) !== normalizedName) return null;
  return basis.food;
}


function getFoodUnitAliases(unit) {
  return [unit?.unitName, ...(unit?.aliases || [])]
    .map((value) => normalize(value || ""))
    .filter(Boolean);
}

function findFoodUnit(food, unitText) {
  const normalizedUnit = normalize(unitText);
  if (!normalizedUnit) return null;

  if (["g", "그램"].includes(normalizedUnit)) {
    return { unitName: "g", grams: 1, aliases: ["g", "그램"] };
  }

  return (food?.units || []).find((unit) => getFoodUnitAliases(unit).includes(normalizedUnit)) || null;
}

function parseKoreanQuantity(value) {
  const text = normalize(value);
  if (!text) return null;

  const numeric = Number(text);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;

  const quantityMap = {
    한: 1,
    하나: 1,
    한개: 1,
    한알: 1,
    한공기: 1,
    한그릇: 1,
    한줌: 1,
    한컵: 1,
    한잔: 1,
    두: 2,
    둘: 2,
    두개: 2,
    두알: 2,
    두공기: 2,
    세: 3,
    셋: 3,
    세개: 3,
    세알: 3,
    세공기: 3,
    네: 4,
    넷: 4,
    네개: 4,
    네알: 4,
    다섯: 5,
    여섯: 6,
    일곱: 7,
    여덟: 8,
    아홉: 9,
    열: 10,
    반: 0.5,
  };

  return quantityMap[text] || null;
}

function isLikelyUnitToken(value) {
  return ["개", "알", "공기", "밥공기", "그릇", "줌", "컵", "잔"].includes(normalize(value));
}

function parseQuantityUnitToken(token) {
  const text = String(token || "").trim();
  if (!text) return null;

  const gramMatch = text.match(/^([0-9]+(?:\.[0-9]+)?)(g|그램)$/i);
  if (gramMatch) {
    return { quantity: toNumber(gramMatch[1]), unitText: gramMatch[2], consumed: 1 };
  }

  if (/^[0-9]+(?:\.[0-9]+)?$/.test(text)) return null;

  const numberMatch = text.match(/^([0-9]+(?:\.[0-9]+)?)(.+)$/);
  if (numberMatch) {
    return { quantity: toNumber(numberMatch[1]), unitText: numberMatch[2], consumed: 1 };
  }

  const koreanQuantityPattern = "한|하나|두|둘|세|셋|네|넷|다섯|여섯|일곱|여덟|아홉|열|반";
  if (new RegExp("^(" + koreanQuantityPattern + ")$").test(text)) return null;

  const koreanMatch = text.match(new RegExp("^(" + koreanQuantityPattern + ")(.+)$"));
  if (koreanMatch) {
    return { quantity: parseKoreanQuantity(koreanMatch[1]), unitText: koreanMatch[2], consumed: 1 };
  }

  return isLikelyUnitToken(text) ? { quantity: 1, unitText: text, consumed: 1 } : null;
}

function parseQuantityUnitTokens(quantityToken, unitToken) {
  const quantity = parseKoreanQuantity(quantityToken);
  if (quantity && unitToken) {
    return { quantity, unitText: unitToken, consumed: 2 };
  }

  const compact = parseQuantityUnitToken(quantityToken);
  if (compact && compact.quantity > 0 && compact.unitText) return compact;

  return null;
}

function parseAttachedFoodUnitToken(token) {
  const text = String(token || "").trim();
  if (!text) return null;

  const quantityPattern = "[0-9]+(?:\\.[0-9]+)?|한|하나|두|둘|세|셋|네|넷|다섯|여섯|일곱|여덟|아홉|열|반";
  const match = text.match(new RegExp("^(.+?)(" + quantityPattern + ")([^0-9\\s]+)$"));
  if (!match) return null;

  const quantity = parseKoreanQuantity(match[2]);
  if (!quantity) return null;

  return {
    name: cleanFoodName(match[1]),
    quantity,
    unitText: match[3],
  };
}

function resolveFoodUnitAmount(name, quantity, unitText, customFoods, basisFood) {
  const cleanQuantity = toNumber(quantity);
  if (cleanQuantity <= 0) return null;

  const normalizedUnit = normalize(unitText);
  if (["g", "그램"].includes(normalizedUnit)) return cleanQuantity;

  const food = basisFood || findFoodByName(name, customFoods);
  const unit = findFoodUnit(food, unitText);
  if (!unit) return null;

  return cleanQuantity * toNumber(unit.grams);
}

function createItem(name, amount, customFoods, rawLine, id, basisFood, displayInfo = {}) {
  const cleanName = cleanFoodName(name);
  const cleanAmount = toNumber(amount);
  const baseItem = {
    id: id || makeId("food"),
    rawLine: rawLine || cleanName + (cleanAmount > 0 ? " " + cleanAmount + "g" : ""),
    name: cleanName,
    amount: cleanAmount,
    ...displayInfo,
  };

  return basisFood ? applyFoodBasisToItem(baseItem, basisFood) : resolveItem(baseItem, customFoods);
}

function parseMemoLine(line, customFoods) {
  const rawLine = line.trim();
  if (!rawLine) return null;

  const entries = parseFoodEntries(rawLine, customFoods);
  return entries[0] || createItem(rawLine, 0, customFoods, rawLine);
}

function itemToMemoLine(item) {
  if (item.displayUnit && toNumber(item.displayAmount) > 0) {
    return item.name + " " + formatAmount(toNumber(item.displayAmount)) + item.displayUnit;
  }

  return item.name + (item.amount > 0 ? " " + formatAmount(item.amount) + "g" : "");
}

function mealToDailyMemoLine(meal) {
  const items = meal.items.map((item) => itemToMemoLine(item)).join(", ");
  return meal.time + (items ? "\t" + items : "");
}

function mealsToDailyMemo(meals) {
  return sortMealsLatestFirst(meals)
    .slice()
    .reverse()
    .map(mealToDailyMemoLine)
    .join("\n");
}


function splitDailyMemoRows(value) {
  const lines = String(value || "").split("\n");
  const rows = lines.length > 0 ? lines : [""];

  return rows.map((line) => {
    const match = line.match(/^(\d{1,2}(?::\d{0,2})?)\s*(.*)$/);
    if (!match) return { time: "", foods: line.trimStart() };

    return {
      time: match[1] || "",
      foods: (match[2] || "").replace(/^\s+/, ""),
    };
  });
}

function appendMemoFoods(existingFoods, addedFoods) {
  const existing = String(existingFoods || "").trim();
  const added = String(addedFoods || "").trim();
  if (!added) return existing;
  return existing ? existing + ", " + added : added;
}

function buildDailyMemoFromRows(rows) {
  const mergedRows = [];

  (rows || []).forEach((row) => {
    const time = String(row.time || "").trim();
    const foods = String(row.foods || "").trimStart();
    if (!time && !foods) return;

    if (!time && foods && mergedRows.length > 0) {
      const lastIndex = mergedRows.length - 1;
      mergedRows[lastIndex] = {
        ...mergedRows[lastIndex],
        foods: appendMemoFoods(mergedRows[lastIndex].foods, foods),
      };
      return;
    }

    mergedRows.push({ time, foods });
  });

  return mergedRows
    .map((row) => row.time + (row.foods ? "\t" + row.foods : ""))
    .join("\n");
}

function splitFoodSegments(text) {
  const segments = [];
  let current = "";
  let depth = 0;

  String(text || "")
    .replace(/，/g, ",")
    .split("")
    .forEach((char) => {
      if (char === "(" || char === "[" || char === "{") depth += 1;
      if (char === ")" || char === "]" || char === "}") depth = Math.max(0, depth - 1);

      if (char === "," && depth === 0) {
        if (current.trim()) segments.push(current.trim());
        current = "";
        return;
      }

      current += char;
    });

  if (current.trim()) segments.push(current.trim());
  return segments;
}

function parseFoodEntries(text, customFoods, options = {}) {
  const entries = [];
  const rowIndex = options.rowIndex ?? 0;
  const basisMap = options.basisMap || {};

  splitFoodSegments(text)
    .forEach((segment, segmentIndex) => {
      const tokens = segment.split(/\s+/).filter(Boolean);
      let index = 0;
      let entryIndex = 0;

      while (index < tokens.length) {
        const token = tokens[index];
        const attachedAmount = token.match(/^(.+?)([0-9]+(?:\.[0-9]+)?)(?:g|그램)$/i);

        if (attachedAmount) {
          const name = cleanFoodName(attachedAmount[1]);
          const amount = toNumber(attachedAmount[2]);
          const basisFood = getMemoFoodBasis(basisMap, rowIndex, segmentIndex, entryIndex, name);
          if (name) entries.push(createItem(name, amount, customFoods, name + " " + amount + "g", undefined, basisFood));
          entryIndex += 1;
          index += 1;
          continue;
        }

        const attachedUnit = parseAttachedFoodUnitToken(token);
        if (attachedUnit?.name) {
          const basisFood = getMemoFoodBasis(basisMap, rowIndex, segmentIndex, entryIndex, attachedUnit.name);
          const amount = resolveFoodUnitAmount(
            attachedUnit.name,
            attachedUnit.quantity,
            attachedUnit.unitText,
            customFoods,
            basisFood
          );

          if (amount !== null) {
            entries.push(createItem(
              attachedUnit.name,
              amount,
              customFoods,
              attachedUnit.name + " " + formatAmount(attachedUnit.quantity) + attachedUnit.unitText,
              undefined,
              basisFood,
              { displayAmount: attachedUnit.quantity, displayUnit: attachedUnit.unitText }
            ));
            entryIndex += 1;
            index += 1;
            continue;
          }
        }

        const nextToken = tokens[index + 1] || "";
        const nextNextToken = tokens[index + 2] || "";
        const nextAmount = nextToken.match(/^([0-9]+(?:\.[0-9]+)?)(?:g|그램)?$/i);
        const separatedGramUnit = nextAmount && /^(g|그램)$/i.test(nextNextToken);
        const name = cleanFoodName(token);

        const unitAmount = parseQuantityUnitTokens(nextToken, nextNextToken);
        if (name && unitAmount) {
          const basisFood = getMemoFoodBasis(basisMap, rowIndex, segmentIndex, entryIndex, name);
          const amount = resolveFoodUnitAmount(name, unitAmount.quantity, unitAmount.unitText, customFoods, basisFood);

          if (amount !== null) {
            entries.push(createItem(
              name,
              amount,
              customFoods,
              name + " " + formatAmount(unitAmount.quantity) + unitAmount.unitText,
              undefined,
              basisFood,
              { displayAmount: unitAmount.quantity, displayUnit: unitAmount.unitText }
            ));
          } else {
            entries.push(createItem(name, 0, customFoods, name, undefined, basisFood));
          }

          entryIndex += 1;
          index += 1 + unitAmount.consumed;
          continue;
        }

        if (name && nextAmount) {
          const amount = toNumber(nextAmount[1]);
          const basisFood = getMemoFoodBasis(basisMap, rowIndex, segmentIndex, entryIndex, name);
          entries.push(createItem(name, amount, customFoods, name + " " + amount + "g", undefined, basisFood));
          entryIndex += 1;
          index += separatedGramUnit ? 3 : 2;
          continue;
        }

        if (name) {
          const basisFood = getMemoFoodBasis(basisMap, rowIndex, segmentIndex, entryIndex, name);
          entries.push(createItem(name, 0, customFoods, name, undefined, basisFood));
          entryIndex += 1;
        }
        index += 1;
      }
    });

  return entries;
}

function parseDailyMemoInput(input, customFoods, basisMap = {}) {
  const lines = String(input)
    .split("\n")
    .map((line, originalIndex) => ({ line: line.trim(), originalIndex }))
    .filter((entry) => entry.line);

  const meals = [];
  const errors = [];

  lines.forEach(({ line, originalIndex }) => {
    const match = line.match(/^(\d{1,2}(?::\d{1,2})?)\s+(.+)$/);

    if (!match) {
      if (meals.length === 0) {
        errors.push(`${originalIndex + 1}번째 줄: 시각을 먼저 입력해 주세요.`);
        return;
      }

      const items = parseFoodEntries(line, customFoods, { basisMap, rowIndex: originalIndex });
      if (items.length === 0) {
        errors.push(`${originalIndex + 1}번째 줄: 음식명을 입력해 주세요.`);
        return;
      }

      const lastIndex = meals.length - 1;
      meals[lastIndex] = {
        ...meals[lastIndex],
        items: [...meals[lastIndex].items, ...items],
      };
      return;
    }

    const time = parseTimeInput(match[1]);
    if (!time) {
      errors.push(`${originalIndex + 1}번째 줄: 시각 형식을 확인해 주세요.`);
      return;
    }

    const items = parseFoodEntries(match[2], customFoods, { basisMap, rowIndex: originalIndex });
    if (items.length === 0) {
      errors.push(`${originalIndex + 1}번째 줄: 음식명을 입력해 주세요.`);
      return;
    }

    meals.push({
      id: makeId("meal"),
      time,
      isOpen: false,
      items,
    });
  });

  return { meals, errors };
}

function mergeMealsWithSameTime(meals) {
  const mergedMeals = [];
  const indexByTime = new Map();

  meals.forEach((meal) => {
    const time = parseTimeInput(meal.time) || meal.time;

    if (!indexByTime.has(time)) {
      indexByTime.set(time, mergedMeals.length);
      mergedMeals.push({
        ...meal,
        time,
        items: [...meal.items],
      });
      return;
    }

    const targetIndex = indexByTime.get(time);
    mergedMeals[targetIndex] = {
      ...mergedMeals[targetIndex],
      isOpen: false,
      items: [...mergedMeals[targetIndex].items, ...meal.items],
    };
  });

  return mergedMeals;
}

function formatTimeDraft(value) {
  const digits = value.replace(/\D/g, "").slice(0, 4);
  if (!digits) return "";

  let hour = "";
  let minuteDigits = "";
  const firstHourDigit = Number(digits[0]);

  if (firstHourDigit >= 3) {
    hour = "0" + digits[0];
    minuteDigits = digits.slice(1);
  } else if (digits.length === 1) {
    return digits;
  } else {
    hour = digits.slice(0, 2);
    minuteDigits = digits.slice(2);
  }

  const hourNumber = Number(hour);
  if (hourNumber > 24) return null;
  if (!minuteDigits) return hour + ":";

  const firstMinuteDigit = Number(minuteDigits[0]);
  if (firstMinuteDigit >= 6) {
    const minute = "0" + minuteDigits[0];
    if (hourNumber === 24 && Number(minute) > 0) return null;
    return hour + ":" + minute;
  }

  if (minuteDigits.length === 1) {
    if (hourNumber === 24 && Number(minuteDigits) > 0) return null;
    return hour + ":" + minuteDigits;
  }

  const minute = minuteDigits.slice(0, 2);
  const minuteNumber = Number(minute);
  if (minuteNumber > 59) return null;
  if (hourNumber === 24 && minuteNumber > 0) return null;

  return hour + ":" + minute;
}

function parseTimeInput(value) {
  const raw = String(value).trim();

  if (/^\d{1,2}$/.test(raw)) {
    const hour = Number(raw);
    if (hour < 0 || hour > 24) return null;

    return String(hour).padStart(2, "0") + ":00";
  }

  const draft = formatTimeDraft(raw);
  if (!draft) return null;

  const match = draft.match(/^(\d{2}):(\d{1,2})?$/);
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  if (hour < 0 || hour > 24 || minute < 0 || minute > 59) return null;
  if (hour === 24 && minute > 0) return null;

  return String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0");
}

function calculateTotals(meals) {
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

function sortMealsLatestFirst(meals) {
  return [...meals].sort((a, b) => b.time.localeCompare(a.time));
}

function useLongPress(onLongPress, delay = 650) {
  const timerRef = useRef(null);
  const didLongPressRef = useRef(false);

  const clear = () => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  return {
    onPointerDown: () => {
      clear();
      didLongPressRef.current = false;
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        didLongPressRef.current = true;
        onLongPress();
      }, delay);
    },
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerCancel: clear,
    onClickCapture: (event) => {
      if (!didLongPressRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      didLongPressRef.current = false;
    },
    onContextMenu: (event) => {
      event.preventDefault();
      clear();
      didLongPressRef.current = true;
      onLongPress();
    },
  };
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
  const [selectedDate, setSelectedDate] = useState(() => new Date());
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
  const [nutritionForm, setNutritionForm] = useState({ baseAmount: "100", kcal: "", carb: "", protein: "", fat: "" });
  const [amountTarget, setAmountTarget] = useState(null);
  const [amountInput, setAmountInput] = useState("");
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
          setNutritionPlan(appState.nutrition_plan);
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

  useEffect(() => {
    if (skipNextMemoSyncRef.current) {
      skipNextMemoSyncRef.current = false;
      return;
    }

    const currentMeals = mealsByDate[selectedDateKey] || [];
    const orderedMeals = sortMealsLatestFirst(currentMeals).slice().reverse();

    setMemoInput(mealsToDailyMemo(currentMeals));
    setMemoFoodBasisMap(buildMemoBasisMapFromMeals(orderedMeals));
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

  const moveSelectedDate = (amount) => {
    setSelectedDate((current) => {
      const nextDate = addDays(current, amount);
      const nextRecord = dailyRecords[getDateKey(nextDate)] || {};
      setMorningWeight(nextRecord.morningWeight ? String(nextRecord.morningWeight) : "");
      setMorningWeightInput("");
      setDayComplete(Boolean(nextRecord.dayComplete));
      return nextDate;
    });
    setIsAddingMeal(false);
    setEditingMealId(null);
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
    setDailyRecords((current) => ({
      ...current,
      [selectedDateKey]: {
        ...current[selectedDateKey],
        dayComplete: true,
        kcal: Math.round(totals.kcal),
        carb: totals.carb,
        protein: totals.protein,
        fat: totals.fat,
        morningWeight: toNumber(morningWeight) || current[selectedDateKey]?.morningWeight || 0,
      },
    }));
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
  const currentMemoSegment = currentMemoBeforeCursor
    .slice(Math.max(currentMemoBeforeCursor.lastIndexOf(","), currentMemoBeforeCursor.lastIndexOf("，")) + 1)
    .trim();
  const memoPreviewTokens = currentMemoSegment.split(/\s+/).filter(Boolean);
  const rawMemoPreviewName = memoCursorIsAttachedToWord
    ? memoPreviewTokens.at(-1)?.toLocaleLowerCase("ko-KR") === "g"
      ? memoPreviewTokens.at(-2)
      : memoPreviewTokens.at(-1)
    : "";
  const memoPreviewName = rawMemoPreviewName &&
    !/^\d{1,2}:?\d{0,2}$/.test(rawMemoPreviewName) &&
    !/^[0-9]+(?:\.[0-9]+)?(?:g|그램)?$/i.test(rawMemoPreviewName)
      ? cleanFoodName(rawMemoPreviewName)
      : "";
  const isSavedAliasPreviewFood = (food) =>
  Boolean(
    memoPreviewName &&
      food?.source === "user_alias" &&
      normalize(food.name) === normalize(memoPreviewName)
  );

  const savedAliasPreviewFood = memoPreviewName
    ? findExactFoodByName(memoPreviewName, customFoods)
    : null;

  const shouldHideMemoPreviewBySavedAlias = Boolean(
    savedAliasPreviewFood &&
      savedAliasPreviewFood.source === "user_alias" &&
      normalize(savedAliasPreviewFood.name) === normalize(memoPreviewName)
  );

  const memoPreviewFoods = memoPreviewName && !shouldHideMemoPreviewBySavedAlias
    ? findFoodMatches(memoPreviewName, customFoods)
    : [];

  const showMemoDbPreview = Boolean(
    memoPreviewName &&
      activeMemoRow.foods.trim() &&
      !memoPreviewHidden &&
      !shouldHideMemoPreviewBySavedAlias
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
    setFormError("");
  };

  const startNewMeal = () => {
    if (dayComplete) return;
    setIsAddingMeal(true);
    setEditingMealId(null);
    setTimeInput("");
    setMemoInput("");
    setMemoFoodBasisMap({});
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
          const basisFood = getMemoFoodBasis(memoFoodBasisMap, rowIndex, segmentIndex, 0, name);
          if (name && resolveFoodUnitAmount(name, compact.quantity, compact.unitText, customFoods, basisFood) !== null) {
            return compact;
          }
        }
      }

      if (tokens.length >= 3) {
        const separated = parseQuantityUnitTokens(tokens.at(-2), lastToken);
        if (separated?.quantity > 0 && separated.unitText) {
          const name = cleanFoodName(tokens.slice(0, -2).join(""));
          const basisFood = getMemoFoodBasis(memoFoodBasisMap, rowIndex, segmentIndex, 0, name);
          if (name && resolveFoodUnitAmount(name, separated.quantity, separated.unitText, customFoods, basisFood) !== null) {
            return separated;
          }
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

  const saveMemoValue = (value) => {
    if (dayComplete) return false;

    const parsed = parseDailyMemoInput(value, customFoods, memoFoodBasisMap);
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

      if (start === end && hasFoodName && /^[0-9]+(?:\.[0-9]+)?$/.test(lastToken)) {
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

    const nextCustomFoods = { ...customFoods, [normalize(aliasName)]: aliasFood };

    if (HAS_SUPABASE_CONFIG && authSession) {
      try {
        await upsertUserAlias(authSession, aliasName, food);
      } catch (error) {
        console.warn("별칭 저장 실패, 로컬 반영 유지:", error);
      }
    }

    setCustomFoods(nextCustomFoods);
    return nextCustomFoods;
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

    const nextCustomFoods = { ...customFoods, [normalize(aliasName)]: aliasFood };

    if (HAS_SUPABASE_CONFIG && authSession) {
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
    setCustomFoods(nextCustomFoods);

    if (options.closeModal) closeNutritionModal();
    return nextCustomFoods;
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
    setNutritionForm({
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
    setNutritionForm({ baseAmount: "100", kcal: "", carb: "", protein: "", fat: "" });
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
    const food = {
      id: "custom-" + normalize(nutritionTarget.name),
      name: cleanFoodName(nutritionTarget.name),
      kcal: toNumber(nutritionForm.kcal) * per100Rate,
      carb: toNumber(nutritionForm.carb) * per100Rate,
      protein: toNumber(nutritionForm.protein) * per100Rate,
      fat: toNumber(nutritionForm.fat) * per100Rate,
    };

    if (baseAmount <= 0 || food.kcal <= 0) return;

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

    const nextCustomFoods = { ...customFoods, [normalize(storedFood.name)]: storedFood };
    setCustomFoods(nextCustomFoods);
    updateMatchingItems((item) =>
      normalize(item.name) === normalize(storedFood.name) ? resolveItem(item, nextCustomFoods) : item
    );
    closeNutritionModal();
  };

  const openMemoMatchChoice = (food) => {
    if (!memoPreviewName || !food) return;
    const segmentIndex = getMemoSegmentIndex(activeMemoRow.foods, activeFoodCursor);
    setMatchChoiceTarget({
      source: "memo",
      rowIndex: activeMemoRowIndex,
      segmentIndex,
      entryIndex: 0,
      aliasName: memoPreviewName,
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

    if (matchChoiceTarget.source === "memo") {
      const key = getMemoBasisKey(matchChoiceTarget.rowIndex, matchChoiceTarget.segmentIndex, matchChoiceTarget.entryIndex || 0);
      setMemoFoodBasisMap((current) => ({
        ...current,
        [key]: {
          aliasName: matchChoiceTarget.aliasName,
          food: matchChoiceTarget.food,
        },
      }));
      setMemoPreviewHidden(true);
    }

    if (matchChoiceTarget.source === "nutrition") {
      applyFoodBasisToMealItem(matchChoiceTarget.mealId, matchChoiceTarget.itemId, matchChoiceTarget.food);
      closeNutritionModal();
    }

    closeMatchChoice();
  };

  const applyMatchForever = async () => {
    if (!matchChoiceTarget) return;

    await saveAliasForFuture(matchChoiceTarget.aliasName, matchChoiceTarget.food);

    if (matchChoiceTarget.source === "memo") {
      const key = getMemoBasisKey(matchChoiceTarget.rowIndex, matchChoiceTarget.segmentIndex, matchChoiceTarget.entryIndex || 0);
      setMemoFoodBasisMap((current) => ({
        ...current,
        [key]: {
          aliasName: matchChoiceTarget.aliasName,
          food: matchChoiceTarget.food,
        },
      }));
      setMemoPreviewHidden(true);
    }

    if (matchChoiceTarget.source === "nutrition") {
      applyFoodBasisToMealItem(matchChoiceTarget.mealId, matchChoiceTarget.itemId, matchChoiceTarget.food);
      closeNutritionModal();
    }

    closeMatchChoice();
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

  const nutritionCandidateFoods = useMemo(() => {
    if (!nutritionTarget) return [];

    const matches = findFoodMatches(nutritionTarget.name, customFoods);
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
    <main className="app-shell">
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
            <MacroBar label="탄수화물" value={totals.carb} target={macroTargets.carb} />
            <MacroBar label="단백질" value={totals.protein} target={macroTargets.protein} />
            <MacroBar label="지방" value={totals.fat} target={macroTargets.fat} />
          </div>
        </div>
      </section>

      {activeTab === "record" ? (
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
                <input
                  ref={(element) => { memoFoodRefs.current[index] = element; }}
                  className="memo-food-input"
                  value={row.foods}
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
                  return (
                    <button
                      key={food.id}
                      type="button"
                      className={"memo-preview-row" + (isSavedAlias ? " is-saved-alias-basis" : "")}
                      onClick={() => openMemoMatchChoice(food)}
                    >
                      <strong>{food.displayName || getFoodDisplayName(food)}</strong>
                      <span>
                        100g {food.kcal}kcal · Carb {formatMacro(food.carb)}g · Pro {formatMacro(food.protein)}g · Fat {formatMacro(food.fat)}g
                      </span>
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
      ) : (
        <StatsScreen stats={stats} plan={activePlan} totals={totals} />
      )}

      <div className="app-footer-actions">
        {activeTab === "record" && (
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

      {amountTarget && (
        <Modal title={amountTarget.name + " 중량 등록"} onClose={closeAmountModal}>
          <form className="modal-form" onSubmit={saveAmount}>
            <label>
              <span>섭취량(g)</span>
              <input
                ref={amountInputRef}
                value={amountInput}
                onChange={(event) => setAmountInput(event.target.value)}
                type="number"
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
        <Modal title={nutritionTarget.name + " 음식 연결/등록"} onClose={closeNutritionModal} className="nutrition-modal">
          <form className="modal-form" onSubmit={saveNutrition}>
            {nutritionCandidateFoods.length > 0 && (
              <div className="alias-candidate-panel">
                <div className="alias-candidate-list">
                  {nutritionCandidateFoods.map((food) => (
                    <button
                      key={food.id}
                      type="button"
                      className={food.isCurrentBasis ? "is-current-basis" : ""}
                      onClick={() => openNutritionMatchChoice(food)}
                    >
                      <strong>{getFoodDisplayName(food)}</strong>
                      <em>100g</em>
                      <span>
                        <b>{Math.round(food.kcal)}kcal</b>
                        <small>C {formatMacro(food.carb)}g P {formatMacro(food.protein)}g F {formatMacro(food.fat)}g</small>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="nutrition-manual-grid">
              <div className="nutrition-manual-row nutrition-manual-row-two">
                <label>
                  <span>기준 중량(g)</span>
                  <input
                    value={nutritionForm.baseAmount}
                    onChange={(event) => setNutritionForm((current) => ({ ...current, baseAmount: event.target.value }))}
                    type="number"
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
                    type="number"
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
                    type="number"
                    min="0"
                    step="0.1"
                  />
                </label>
                <label>
                  <span>Pro</span>
                  <input
                    value={nutritionForm.protein}
                    onChange={(event) => setNutritionForm((current) => ({ ...current, protein: event.target.value }))}
                    type="number"
                    min="0"
                    step="0.1"
                  />
                </label>
                <label>
                  <span>Fat</span>
                  <input
                    value={nutritionForm.fat}
                    onChange={(event) => setNutritionForm((current) => ({ ...current, fat: event.target.value }))}
                    type="number"
                    min="0"
                    step="0.1"
                  />
                </label>
              </div>
            </div>
            <ModalActions onCancel={closeNutritionModal} submitText="등록" />
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
                type="number"
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
            type="number"
            value={inputValue}
            min="30"
            max="200"
            step="0.1"
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

function StatsScreen({ stats, plan, totals }) {
  const [calorieRange, setCalorieRange] = useState("7");
  const [weightRange, setWeightRange] = useState("7");
  const calorieTrend = stats.makeCalorieTrend(calorieRange);
  const weightTrend = stats.makeWeightTrend(weightRange);

  return (
    <section className="stats-screen" aria-label="통계">
      <div className="stats-card">
        <div className="section-title">
          <strong>목표 달성률</strong>
          <small>{plan.calorieGoal.toLocaleString()} kcal 기준</small>
        </div>
        <StatsBar label="칼로리" value={stats.currentKcal} target={plan.calorieGoal} />
        <StatsBar label="탄수화물" value={totals.carb} target={plan.macroTargets.carb} unit="g" />
        <StatsBar label="단백질" value={totals.protein} target={plan.macroTargets.protein} unit="g" />
        <StatsBar label="지방" value={totals.fat} target={plan.macroTargets.fat} unit="g" />
      </div>

      <div className="stats-card weight-chart-card">
        <div className="section-title chart-title-row">
          <strong>일 섭취 칼로리</strong>
          <ChartRangeToggle value={calorieRange} onChange={setCalorieRange} />
        </div>
        <LineChart points={calorieTrend} valueKey="kcal" unit="kcal" emptyText="아직 칼로리 기록이 없어." />
      </div>

      <div className="stats-card weight-chart-card">
        <div className="section-title chart-title-row">
          <strong>체중 변화</strong>
          <ChartRangeToggle value={weightRange} onChange={setWeightRange} />
        </div>
        <LineChart points={weightTrend} valueKey="weight" unit="kg" emptyText="아직 체중 기록이 없어." />
      </div>
    </section>
  );
}

function ChartRangeToggle({ value, onChange }) {
  return (
    <div className="chart-range-toggle" role="group" aria-label="그래프 기간">
      <button className={value === "7" ? "is-selected" : ""} type="button" onClick={() => onChange("7")}>
        최근 7일
      </button>
      <button className={value === "30" ? "is-selected" : ""} type="button" onClick={() => onChange("30")}>
        최근 30일
      </button>
    </div>
  );
}

function LineChart({ points, valueKey, unit, emptyText }) {
  const [selectedIndex, setSelectedIndex] = useState(null);
  const pointKeys = points.map((point) => point.key).join("|");

  useEffect(() => {
    setSelectedIndex(null);
  }, [pointKeys, valueKey, unit]);

  if (points.length === 0) {
    return <div className="chart-empty-state">{emptyText}</div>;
  }

  const values = points.map((point) => point[valueKey]).filter((value) => value > 0);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;
  const range = Math.max(0.1, max - min);

  const getPointPosition = (point, index) => {
    const x = points.length === 1 ? 50 : (index / (points.length - 1)) * 100;
    const y = values.length === 1 ? 50 : 86 - ((point[valueKey] - min) / range) * 66;
    return { x, y };
  };

  const polyline = points
    .map((point, index) => {
      const { x, y } = getPointPosition(point, index);
      return x + "," + y;
    })
    .join(" ");

  const selectedPoint = selectedIndex === null ? null : points[selectedIndex];
  const selectedPosition = selectedPoint ? getPointPosition(selectedPoint, selectedIndex) : null;
  const selectedPlacement = selectedPosition
    ? selectedPosition.x < 18
      ? " is-left-edge"
      : selectedPosition.x > 82
        ? " is-right-edge"
        : ""
    : "";

  const shouldShowLabel = (index) => {
    if (points.length <= 8) return true;
    return index === 0 || index === points.length - 1 || index % 5 === 0;
  };

  return (
    <div className="weight-line-chart" onClick={() => setSelectedIndex(null)}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <polyline points={polyline} />
      </svg>
      <div className="weight-points">
        {points.map((point, index) => {
          const { x, y } = getPointPosition(point, index);
          const valueText = formatMacro(point[valueKey]) + unit;
          const dateText = point.tooltipLabel || point.label;
          return (
            <button
              key={point.key || point.label}
              className={selectedIndex === index ? "is-selected" : ""}
              type="button"
              style={{ left: x + "%", top: y + "%" }}
              aria-label={valueText + " / " + dateText}
              onClick={(event) => {
                event.stopPropagation();
                setSelectedIndex((current) => (current === index ? null : index));
              }}
            />
          );
        })}
      </div>
      <div className="weight-labels" style={{ gridTemplateColumns: "repeat(" + points.length + ", minmax(0, 1fr))" }}>
        {points.map((point, index) => (
          <span key={point.key || point.label}>{shouldShowLabel(index) ? point.label : ""}</span>
        ))}
      </div>
      {selectedPoint && selectedPosition && (
        <div
          className={"chart-point-tooltip" + selectedPlacement}
          style={{ left: selectedPosition.x + "%", top: selectedPosition.y + "%" }}
        >
          <strong>{formatMacro(selectedPoint[valueKey])}{unit}</strong>
          <span>{selectedPoint.tooltipLabel || selectedPoint.label}</span>
        </div>
      )}
    </div>
  );
}

function StatsBar({ label, value, target, unit = "kcal" }) {
  const percent = target > 0 ? Math.round((value / target) * 100) : 0;
  const width = Math.min(100, percent);
  const isOver = value > target;
  return (
    <div className="stats-bar-row">
      <div>
        <span>{label}</span>
        <strong>{formatMacro(value)} / {target}{unit}</strong>
        <small>{percent}%</small>
      </div>
      <div className="stats-track">
        <i className={isOver ? "over" : "good"} style={{ width: width + "%" }} />
      </div>
    </div>
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
    </nav>
  );
}

function SetupScreen({ profile, onProfileChange, onSubmit }) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const canCalculate = isRequiredProfileFilled(profile);

  const handleStepsChange = (value) => {
    onProfileChange("steps", value);
    const nextActivity = getActivityBySteps(value);
    if (nextActivity) onProfileChange("jobActivity", nextActivity);
  };

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
            <input type="number" value={profile.age} min="14" max="90" onChange={(event) => onProfileChange("age", event.target.value)} />
            <small>세</small>
          </div>

          <div className="profile-row">
            <span className="row-icon">키</span>
            <strong>키</strong>
            <input type="number" value={profile.height} min="120" max="230" onChange={(event) => onProfileChange("height", event.target.value)} />
            <small>cm</small>
          </div>

          <div className="profile-row">
            <span className="row-icon">몸</span>
            <strong>체중</strong>
            <input type="number" value={profile.weight} min="30" max="200" step="0.1" onChange={(event) => onProfileChange("weight", event.target.value)} />
            <small>kg</small>
          </div>

          <BodyFatField profile={profile} onProfileChange={onProfileChange} />
        </section>

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

          <label className="precise-steps-field">
            <span>정확한 평균 걸음 수를 알고 있다면 입력하세요. <em>(선택)</em></span>
            <div>
              <input
                type="number"
                value={profile.steps || ""}
                min="0"
                max="40000"
                step="1"
                onChange={(event) => handleStepsChange(event.target.value)}
              />
              <small>보/일</small>
            </div>
          </label>
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

        <button className="advanced-toggle" type="button" onClick={() => setShowAdvanced((current) => !current)}>
          <span>{showAdvanced ? "-" : "+"} 상세 운동 정보 입력 <em>(선택)</em></span>
          <strong>{showAdvanced ? "접기" : "열기"}</strong>
        </button>

        {showAdvanced && (
          <section className="advanced-panel">
            <NumberField label="골격근량" unit="kg" value={profile.muscleMass} min="10" max="70" step="0.1" onChange={(value) => onProfileChange("muscleMass", value)} />
            <NumberField label="웨이트 주 횟수" unit="회/주" value={profile.weightSessions} min="0" max="14" onChange={(value) => onProfileChange("weightSessions", value)} />
            <NumberField label="유산소 주 횟수" unit="회/주" value={profile.cardioSessions} min="0" max="14" onChange={(value) => onProfileChange("cardioSessions", value)} />
            <NumberField label="유산소 1회 평균" unit="분" value={profile.cardioMinutes} min="0" max="300" step="5" onChange={(value) => onProfileChange("cardioMinutes", value)} />
          </section>
        )}

        {!canCalculate && <p className="setup-required-hint">성별, 나이, 키, 체중, 활동량, 목표를 모두 입력하면 계산할 수 있어요.</p>}

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
          type="number"
          value={value || ""}
          min={min}
          max={max}
          step={step}
          onChange={(event) => onChange(event.target.value)}
        />
        <small>{unit}</small>
      </div>
    </label>
  );
}

function BodyFatField({ profile, onProfileChange }) {
  return (
    <div className="profile-row body-fat-row">
      <span className="row-icon">지</span>
      <div className="row-label-stack">
        <strong>체지방량 <em>(선택)</em></strong>
        <em>또는 체지방률</em>
      </div>
      <input
        type="number"
        value={profile.bodyFatValue ?? profile.bodyFatMass}
        min="0"
        max={profile.bodyFatUnit === "percent" ? "70" : "140"}
        step="0.1"
        onChange={(event) => onProfileChange("bodyFatValue", event.target.value)}
      />
      <select value={profile.bodyFatUnit || "kg"} onChange={(event) => onProfileChange("bodyFatUnit", event.target.value)}>
        <option value="kg">kg</option>
        <option value="percent">%</option>
      </select>
    </div>
  );
}

function ActivityOptionCard({ option, selected, onSelect }) {
  return (
    <button type="button" className={selected ? "activity-option is-selected" : "activity-option"} onClick={onSelect}>
      <div>
        <strong>{option.label}</strong>
        <small>{option.description}</small>
      </div>
      <em>{option.stepsLabel}</em>
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


const MACRO_CALORIE_FACTORS = {
  carb: 4,
  protein: 4,
  fat: 9,
};

function getTargetFormValues(form) {
  return {
    calorieGoal: Math.max(0, Math.round(toNumber(form.calorieGoal))),
    carb: Math.max(0, Math.round(toNumber(form.carb))),
    protein: Math.max(0, Math.round(toNumber(form.protein))),
    fat: Math.max(0, Math.round(toNumber(form.fat))),
  };
}

function targetValuesToForm(values) {
  return {
    calorieGoal: values.calorieGoal > 0 ? String(values.calorieGoal) : "",
    carb: String(Math.max(0, Math.round(values.carb))),
    protein: String(Math.max(0, Math.round(values.protein))),
    fat: String(Math.max(0, Math.round(values.fat))),
  };
}

function getMacroCalories(values) {
  return values.carb * 4 + values.protein * 4 + values.fat * 9;
}

function getMacroCalorieGap(values) {
  return values.calorieGoal - getMacroCalories(values);
}

function balanceTargetValues(values, locks, changedField = "calorieGoal") {
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

function cleanIntegerInput(value) {
  return String(value).replace(/\D/g, "");
}

function getGapTone(gap) {
  const absoluteGap = Math.abs(gap);
  if (absoluteGap <= 20) return "ok";
  if (absoluteGap <= 100) return "notice";
  return "warning";
}

function PlanResultScreen({ plan, onPlanChange, onBack, onStart }) {
  const createTargetForm = (targetPlan) => ({
    calorieGoal: String(targetPlan.calorieGoal),
    carb: String(targetPlan.macroTargets.carb),
    protein: String(targetPlan.macroTargets.protein),
    fat: String(targetPlan.macroTargets.fat),
  });

  const [isEditingTargets, setIsEditingTargets] = useState(false);
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
      ? "유지 칼로리 대비 +10%"
      : plan.goalLabel === "감량"
        ? "유지 칼로리 대비 -15%"
        : "유지 칼로리 기준";
  const targetGuideText = plan.isManualTarget
    ? "수정한 목표가 기록창과 통계창에 반영됩니다."
    : plan.guide;

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
            <strong>{plan.calorieGoal.toLocaleString()} kcal</strong>
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
                  type="number"
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
          <small>Katch-McArdle 기반</small>
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
        <DetailRow label="체지방률" value={formatMacro(plan.details.bodyFatRate) + " %"} />
        <DetailRow label="제지방량" value={formatMacro(plan.details.leanMass) + " kg"} />
        <DetailRow label="체중" value={formatMacro(plan.profile.weight) + " kg"} />
        <DetailRow label="골격근량" value={formatMacro(plan.profile.muscleMass) + " kg"} />
      </section>

      <div className="result-actions">
        <button className="ghost-button" type="button" onClick={onBack}>다시 입력</button>
        <button className="primary-button" type="button" onClick={onStart}>식단 메모 시작</button>
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
          type="number"
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

function MacroLegend({ label, value, percent, tone }) {
  return (
    <div className="macro-legend">
      <i className={"legend-dot " + tone} />
      <span>{label}</span>
      <strong>{value}g</strong>
      <small>{percent}%</small>
    </div>
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

function MacroBar({ label, value, target }) {
  const percent = Math.min(100, Math.round((value / target) * 100));
  const isOver = value > target;

  return (
    <div className="macro-row">
      <div className="macro-copy">
        <span>{label}</span>
        <strong>
          {formatMacro(value)}/{target}g
        </strong>
      </div>
      <div className="macro-track">
        <div className={isOver ? "macro-fill is-over" : "macro-fill"} style={{ width: percent + "%" }} />
      </div>
    </div>
  );
}

function MealCard({ meal, onToggle, onEditMeal, onLongPress, onFoodLongPress, onOpenAmount, onOpenNutrition }) {
  const longPressProps = useLongPress(onLongPress);
  const mealTotals = calculateTotals([meal]);

  return (
    <article className="meal-card">
      <header className="meal-header meal-header-clickable" {...longPressProps} onClick={onEditMeal}>
        <div className="meal-header-main">
          <strong className="meal-time">{meal.time}</strong>
          <div className="meal-summary-inline">
            <span className="meal-summary-kcal">{Math.round(mealTotals.kcal)} kcal</span>
            <span className="meal-summary-macros">
              C {formatMacro(mealTotals.carb)}g P {formatMacro(mealTotals.protein)}g F {formatMacro(mealTotals.fat)}g
            </span>
          </div>
        </div>
        <button
          type="button"
          className="collapse-button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onToggle();
          }}
          aria-label="식단 펼치기 접기"
        >
          {meal.isOpen ? "접기" : "펼치기"}
        </button>
      </header>

      {meal.isOpen && (
        <div className="food-list">
          {meal.items.map((item) => (
            <FoodRow
              key={item.id}
              mealId={meal.id}
              item={item}
              onLongPress={() => onFoodLongPress(item.id)}
              onOpenAmount={onOpenAmount}
              onOpenNutrition={onOpenNutrition}
            />
          ))}
        </div>
      )}
    </article>
  );
}

function FoodRow({ mealId, item, onLongPress, onOpenAmount, onOpenNutrition }) {
  const longPressProps = useLongPress(onLongPress);
  const needsAmount = item.amount <= 0;
  const needsNutrition = !item.per100;
  const needsRegistration = needsAmount || needsNutrition;
  const matchedFoodName = item.matchedFoodName || "";
  const showMatchedBasis = matchedFoodName && normalize(matchedFoodName) !== normalize(item.name);
  const registrationTitle = needsNutrition && needsAmount ? "중량·영양성분 미등록" : needsNutrition ? "영양성분 미등록" : "중량 미등록";
  const registrationCopy = needsNutrition
    ? "기존 DB에 연결하거나 직접 등록하면 다음부터 자동 계산돼."
    : "섭취 중량만 입력하면 바로 계산돼.";

  const stopNestedTap = (event) => {
    event.stopPropagation();
  };

  return (
    <div
      className="food-row food-row-clickable"
      {...longPressProps}
      onClick={() => onOpenNutrition(mealId, item)}
      title="기준 음식 연결/수정"
    >
      <div className="food-main">
        <strong>
          {item.name}
          {showMatchedBasis && <span className="food-basis-inline">({matchedFoodName})</span>}
        </strong>
        {item.amount > 0 && (
          <span>
            {item.displayUnit && toNumber(item.displayAmount) > 0
              ? formatAmount(toNumber(item.displayAmount)) + item.displayUnit
              : formatAmount(item.amount) + "g"}
          </span>
        )}
      </div>

      <div className="food-detail">
        {item.nutrients ? (
          <span>
            {Math.round(item.nutrients.kcal)}kcal Carb {formatMacro(item.nutrients.carb)}g Pro {formatMacro(item.nutrients.protein)}g Fat {formatMacro(item.nutrients.fat)}g
          </span>
        ) : item.per100 ? (
          <span>
            100g {Math.round(item.per100.kcal)}kcal Carb {formatMacro(item.per100.carb)}g Pro {formatMacro(item.per100.protein)}g Fat {formatMacro(item.per100.fat)}g
          </span>
        ) : needsAmount ? (
          <span>중량과 영양성분을 등록하면 자동 계산돼.</span>
        ) : (
          <span>영양성분을 등록하면 자동 계산돼.</span>
        )}
      </div>

      {needsRegistration && (
        <div className="food-register-actions" aria-label={registrationTitle}>
          {needsNutrition && (
            <button
              type="button"
              onPointerDown={stopNestedTap}
              onClick={(event) => {
                event.stopPropagation();
                onOpenNutrition(mealId, item);
              }}
              title={registrationCopy}
            >
              음식 연결/등록
            </button>
          )}
          {needsAmount && (
            <button
              type="button"
              onPointerDown={stopNestedTap}
              onClick={(event) => {
                event.stopPropagation();
                onOpenAmount(mealId, item);
              }}
              title={registrationCopy}
            >
              중량 등록
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Modal({ title, children, onClose, className = "" }) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div className={`modal-card ${className}`.trim()} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <strong>{title}</strong>
          <button type="button" onClick={onClose} aria-label="닫기">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ModalActions({ onCancel, submitText }) {
  return (
    <div className="modal-actions">
      <button type="button" className="ghost-button" onClick={onCancel}>
        취소
      </button>
      <button type="submit" className="primary-button">
        {submitText}
      </button>
    </div>
  );
}
