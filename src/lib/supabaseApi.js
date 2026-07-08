import { buildFoodMap, cleanFoodName, getFoodTargetIds, normalize } from "../utils/foodMatch";
import { toNumber } from "../utils/nutrition";

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "";

export const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || "";

export const HAS_SUPABASE_CONFIG = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);

export const SUPABASE_AUTH_STORAGE_KEY = "diet-app-supabase-session";

export function loadStoredSession() {
  try {
    const raw = window.localStorage.getItem(SUPABASE_AUTH_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveStoredSession(session) {
  if (!session) {
    window.localStorage.removeItem(SUPABASE_AUTH_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(SUPABASE_AUTH_STORAGE_KEY, JSON.stringify(session));
}

export async function requestSupabaseAuth(path, body, accessToken) {
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

export async function signInWithEmail(email, password) {
  return requestSupabaseAuth("/auth/v1/token?grant_type=password", { email, password });
}

export async function signUpWithEmail(email, password) {
  return requestSupabaseAuth("/auth/v1/signup", { email, password });
}

export async function refreshSupabaseSession(refreshToken) {
  if (!refreshToken) throw new Error("저장된 로그인 정보를 확인하지 못했어.");
  return requestSupabaseAuth("/auth/v1/token?grant_type=refresh_token", { refresh_token: refreshToken });
}

export function getSessionExpiresAtMs(session) {
  if (session?.expires_at) return Number(session.expires_at) * 1000;
  if (session?.expires_in) return Date.now() + Number(session.expires_in) * 1000;
  return 0;
}

export function isSessionExpiringSoon(session, bufferMs = 60 * 1000) {
  const expiresAtMs = getSessionExpiresAtMs(session);
  if (!expiresAtMs) return false;
  return expiresAtMs - Date.now() <= bufferMs;
}

export function mergeAuthSession(currentSession, nextSession) {
  if (!nextSession?.access_token) return currentSession;
  return {
    ...currentSession,
    ...nextSession,
    user: nextSession.user || currentSession?.user || null,
  };
}

export async function signOutFromSupabase(session) {
  if (!session?.access_token) return;
  await requestSupabaseAuth("/auth/v1/logout", {}, session.access_token);
}

export async function requestSupabaseRest(path, options = {}, accessToken) {
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

export function getSessionUserId(session) {
  return session?.user?.id || session?.user_id || session?.sub || null;
}

export function isJwtExpiredError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return message.includes("jwt expired") || message.includes("token is expired");
}

export async function fetchFoodDatabase(session) {
  const accessToken = session?.access_token;
  const userId = getSessionUserId(session);

  const appFoodsPath = "/app_foods?select=app_food_id,display_name,raw_food_id,category,default_unit,default_amount,search_priority,raw_foods(raw_food_id,raw_name,kcal_per_100g,carb_g_per_100g,protein_g_per_100g,fat_g_per_100g)&order=search_priority.desc,display_name.asc";
  const foodSearchTermsPath = "/food_search_terms?select=term_id,term_text,term_norm,app_food_id,weight&order=weight.desc,term_text.asc";
  const foodUnitsPath = "/food_units?select=unit_id,app_food_id,unit_name,grams,is_default,aliases&order=app_food_id.asc,unit_name.asc";
  const userFoodUnitsPath = "/user_food_units?select=user_unit_id,user_id,app_food_id,user_food_id,unit_name,unit_norm,grams,created_at,updated_at&user_id=eq." + encodeURIComponent(userId || "") + "&order=updated_at.desc,unit_name.asc";

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
  const userFoodUnitsPromise = userId && accessToken
    ? safeUserRequest(requestSupabaseRest(userFoodUnitsPath, {}, accessToken))
    : Promise.resolve([]);

  const [appFoods, userAliases, userFoods, foodSearchTerms, foodUnits, userFoodUnits] = await Promise.all([
    appFoodsPromise,
    userAliasesPromise,
    userFoodsPromise,
    foodSearchTermsPromise,
    foodUnitsPromise,
    userFoodUnitsPromise,
  ]);

  return buildFoodMap(appFoods || [], userAliases || [], userFoods || [], foodSearchTerms || [], foodUnits || [], userFoodUnits || []);
}

export async function upsertUserFood(session, food) {
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

export async function upsertUserAlias(session, aliasText, food) {
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

export async function deleteUserAlias(session, alias) {
  const userId = getSessionUserId(session);
  if (!userId) throw new Error("사용자 정보를 확인하지 못했어.");

  const aliasId = alias?.aliasId || (String(alias?.id || "").startsWith("alias-") ? String(alias.id).replace("alias-", "") : "");
  const aliasText = cleanFoodName(alias?.aliasText || alias?.name || "");
  const encodedUserId = encodeURIComponent(userId);

  const targetPath = aliasId && /^\d+$/.test(String(aliasId))
    ? "/user_aliases?user_id=eq." + encodedUserId + "&alias_id=eq." + encodeURIComponent(aliasId)
    : "/user_aliases?user_id=eq." + encodedUserId + "&alias_text=eq." + encodeURIComponent(aliasText);

  await requestSupabaseRest(
    targetPath,
    { method: "DELETE", prefer: "return=minimal" },
    session?.access_token
  );
}

export async function updateUserFood(session, userFoodId, food) {
  const userId = getSessionUserId(session);
  if (!userId) throw new Error("사용자 정보를 확인하지 못했어.");
  if (!userFoodId) throw new Error("수정할 개인 음식 ID를 확인하지 못했어.");

  const payload = {
    food_name: cleanFoodName(food.name || food.food_name),
    base_amount: toNumber(food.base_amount ?? food.base_amount_g) || 100,
    base_unit: food.base_unit || "g",
    kcal: toNumber(food.kcal),
    carb_g: toNumber(food.carb_g ?? food.carb),
    protein_g: toNumber(food.protein_g ?? food.protein),
    fat_g: toNumber(food.fat_g ?? food.fat),
  };

  const rows = await requestSupabaseRest(
    "/user_foods?user_id=eq." + encodeURIComponent(userId) + "&user_food_id=eq." + encodeURIComponent(userFoodId),
    {
      method: "PATCH",
      body: payload,
      prefer: "return=representation",
    },
    session?.access_token
  );

  return Array.isArray(rows) && rows[0] ? rows[0] : { ...payload, user_id: userId, user_food_id: userFoodId };
}

export async function deleteUserFood(session, food) {
  const userId = getSessionUserId(session);
  if (!userId) throw new Error("사용자 정보를 확인하지 못했어.");

  const userFoodId = food?.userFoodId || food?.user_food_id || null;
  if (!userFoodId) return;

  const encodedUserId = encodeURIComponent(userId);
  const encodedFoodId = encodeURIComponent(userFoodId);

  // 개인 음식에 연결된 별칭을 먼저 지워야 FK 제약이 있어도 안전하다.
  await requestSupabaseRest(
    "/user_aliases?user_id=eq." + encodedUserId + "&user_food_id=eq." + encodedFoodId,
    { method: "DELETE", prefer: "return=minimal" },
    session?.access_token
  );

  await requestSupabaseRest(
    "/user_foods?user_id=eq." + encodedUserId + "&user_food_id=eq." + encodedFoodId,
    { method: "DELETE", prefer: "return=minimal" },
    session?.access_token
  );
}

export async function upsertUserFoodUnit(session, food, unitName, grams) {
  const userId = getSessionUserId(session);
  if (!userId) throw new Error("사용자 정보를 확인하지 못했어.");

  const ids = getFoodTargetIds(food);
  if (!ids.appFoodId && !ids.userFoodId) throw new Error("단위를 연결할 음식을 먼저 선택해야 해.");

  const cleanUnitName = cleanFoodName(unitName);
  const unitNorm = normalize(cleanUnitName);
  const cleanGrams = toNumber(grams);
  if (!cleanUnitName || cleanGrams <= 0) throw new Error("단위명과 g을 확인해줘.");

  const encodedUserId = encodeURIComponent(userId);
  const targetQuery = ids.appFoodId
    ? "&app_food_id=eq." + encodeURIComponent(ids.appFoodId)
    : "&user_food_id=eq." + encodeURIComponent(ids.userFoodId);

  const existingRows = await requestSupabaseRest(
    "/user_food_units?select=user_unit_id&user_id=eq." + encodedUserId + targetQuery + "&unit_norm=eq." + encodeURIComponent(unitNorm),
    {},
    session?.access_token
  );

  const payload = {
    user_id: userId,
    app_food_id: ids.appFoodId,
    user_food_id: ids.userFoodId,
    unit_name: cleanUnitName,
    grams: cleanGrams,
  };

  if (Array.isArray(existingRows) && existingRows[0]?.user_unit_id) {
    const rows = await requestSupabaseRest(
      "/user_food_units?user_id=eq." + encodedUserId + "&user_unit_id=eq." + encodeURIComponent(existingRows[0].user_unit_id),
      {
        method: "PATCH",
        body: { unit_name: cleanUnitName, grams: cleanGrams },
        prefer: "return=representation",
      },
      session?.access_token
    );

    return Array.isArray(rows) && rows[0] ? rows[0] : { ...payload, user_unit_id: existingRows[0].user_unit_id };
  }

  const rows = await requestSupabaseRest(
    "/user_food_units",
    {
      method: "POST",
      body: payload,
      prefer: "return=representation",
    },
    session?.access_token
  );

  return Array.isArray(rows) && rows[0] ? rows[0] : payload;
}

export async function updateUserFoodUnit(session, unit, form) {
  const userId = getSessionUserId(session);
  if (!userId) throw new Error("사용자 정보를 확인하지 못했어.");

  const unitId = unit?.userUnitId || unit?.user_unit_id;
  if (!unitId) throw new Error("수정할 단위 ID를 확인하지 못했어.");

  const payload = {
    unit_name: cleanFoodName(form.unitName || unit.unitName),
    grams: toNumber(form.grams),
  };

  if (!payload.unit_name || payload.grams <= 0) throw new Error("단위명과 g을 확인해줘.");

  const rows = await requestSupabaseRest(
    "/user_food_units?user_id=eq." + encodeURIComponent(userId) + "&user_unit_id=eq." + encodeURIComponent(unitId),
    {
      method: "PATCH",
      body: payload,
      prefer: "return=representation",
    },
    session?.access_token
  );

  return Array.isArray(rows) && rows[0] ? rows[0] : { ...unit, ...payload, user_unit_id: unitId };
}

export async function deleteUserFoodUnit(session, unit) {
  const userId = getSessionUserId(session);
  if (!userId) throw new Error("사용자 정보를 확인하지 못했어.");

  const unitId = unit?.userUnitId || unit?.user_unit_id;
  if (!unitId) throw new Error("삭제할 단위 ID를 확인하지 못했어.");

  await requestSupabaseRest(
    "/user_food_units?user_id=eq." + encodeURIComponent(userId) + "&user_unit_id=eq." + encodeURIComponent(unitId),
    { method: "DELETE", prefer: "return=minimal" },
    session?.access_token
  );
}

export async function fetchUserAppState(session) {
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

export async function upsertUserAppState(session, state) {
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

export async function fetchUserDailyLogs(session) {
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

export async function upsertUserDailyLog(session, dateKey, meals, dailyRecord) {
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
