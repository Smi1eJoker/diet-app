import { formatMacro, toNumber } from "./nutrition";

export function toFoodEntry(row, fallbackId) {
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

export function toFoodUnitEntry(row, source = "common") {
  return {
    userUnitId: row.user_unit_id || row.userUnitId || null,
    unitId: row.unit_id || row.unitId || row.user_unit_id || null,
    appFoodId: row.app_food_id || row.appFoodId || null,
    userFoodId: row.user_food_id || row.userFoodId || null,
    unitName: cleanFoodName(row.unit_name || row.unitName || ""),
    grams: toNumber(row.grams),
    isDefault: Boolean(row.is_default || row.isDefault),
    aliases: Array.isArray(row.aliases) ? row.aliases.map(cleanFoodName).filter(Boolean) : [],
    source,
  };
}

export function buildFoodMap(appFoods = [], userAliases = [], userFoods = [], foodSearchTerms = [], foodUnits = [], userFoodUnits = []) {
  const nextMap = {};
  const appFoodsById = {};
  const userFoodsById = {};
  const unitsByAppFoodId = {};
  const unitsByUserFoodId = {};

  foodUnits.forEach((row) => {
    if (!row.app_food_id) return;
    const key = String(row.app_food_id);
    const unit = toFoodUnitEntry(row, "common");

    if (!unit.unitName || unit.grams <= 0) return;
    unitsByAppFoodId[key] = [...(unitsByAppFoodId[key] || []), unit];
  });

  userFoodUnits.forEach((row) => {
    const unit = toFoodUnitEntry(row, "user");
    if (!unit.unitName || unit.grams <= 0) return;

    if (unit.appFoodId) {
      const key = String(unit.appFoodId);
      unitsByAppFoodId[key] = [unit, ...(unitsByAppFoodId[key] || [])];
    }

    if (unit.userFoodId) {
      const key = String(unit.userFoodId);
      unitsByUserFoodId[key] = [unit, ...(unitsByUserFoodId[key] || [])];
    }
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
    const foodWithUnits = {
      ...food,
      units: food.userFoodId ? (unitsByUserFoodId[String(food.userFoodId)] || []) : [],
    };
    nextMap[normalize(foodWithUnits.name)] = foodWithUnits;
    if (foodWithUnits.userFoodId) userFoodsById[String(foodWithUnits.userFoodId)] = foodWithUnits;
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
      aliasId: alias.alias_id || null,
      aliasText: aliasName,
      name: aliasName,
      canonicalName: canonical.name,
      aliasTargetSource: alias.user_food_id ? "user_food" : "app_food",
      source: "user_alias",
    };
  });

  return nextMap;
}

export function normalize(value) {
  return String(value || "")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^0-9a-z가-힣]+/g, "");
}

export function addUniqueToken(tokens, token) {
  if (token && !tokens.includes(token)) tokens.push(token);
}

export function getFoodSearchTokens(value) {
  const text = normalize(value);
  if (!text) return [];

  const tokens = [];
  const add = (token) => addUniqueToken(tokens, normalize(token));

  // 후보 추천 전용 토큰이다. 자동 계산에는 절대 사용하지 않는다.
  // 사용자 표현과 DB 표준 표현을 같이 넣어 후보 폭을 넓힌다.
  const rules = [
    { tokens: ["닭"], patterns: ["닭고기", "닭가슴", "닭안심", "닭다리", "닭날개", "닭찌", "치킨"] },
    { tokens: ["소", "소고기", "쇠고기", "한우"], patterns: ["소고기", "쇠고기", "한우", "우둔", "양지", "채끝"] },
    { tokens: ["돼지", "돼지고기"], patterns: ["돼지고기", "돼지", "삼겹", "목살", "앞다리", "뒷다리", "항정", "가브리"] },
    { tokens: ["오리"], patterns: ["오리"] },

    { tokens: ["가슴", "가슴살"], patterns: ["가슴살", "가슴"] },
    { tokens: ["안심"], patterns: ["안심"] },
    { tokens: ["등심"], patterns: ["등심"] },
    { tokens: ["목살", "목심"], patterns: ["목살", "목심"] },
    { tokens: ["삼겹", "삼겹살"], patterns: ["삼겹", "삼겹살"] },
    { tokens: ["갈비"], patterns: ["갈비"] },
    { tokens: ["사태"], patterns: ["사태"] },
    { tokens: ["양지"], patterns: ["양지"] },
    { tokens: ["채끝"], patterns: ["채끝"] },
    { tokens: ["다리"], patterns: ["다리", "허벅"] },
    { tokens: ["날개"], patterns: ["날개", "윙", "봉"] },

    { tokens: ["생것"], patterns: ["생것", "생"] },
    { tokens: ["구운", "구이"], patterns: ["구운", "구이", "구웠", "팬", "석쇠", "오븐"] },
    { tokens: ["삶은", "삶"], patterns: ["삶", "삶은", "수육"] },
    { tokens: ["볶은", "볶"], patterns: ["볶", "볶은"] },
    { tokens: ["튀긴", "튀김"], patterns: ["튀김", "튀긴", "프라이드"] },

    { tokens: ["밥", "백미", "백미밥", "쌀밥", "공기밥"], patterns: ["밥", "공기밥", "쌀밥", "백미밥", "흰밥", "햇반"] },
    { tokens: ["현미", "현미밥"], patterns: ["현미", "현미밥"] },
    { tokens: ["귀리"], patterns: ["귀리"] },
    { tokens: ["보리"], patterns: ["보리"] },
    { tokens: ["잡곡"], patterns: ["잡곡", "혼합곡"] },
    { tokens: ["흑미"], patterns: ["흑미"] },

    { tokens: ["계란", "달걀"], patterns: ["계란", "달걀", "계란후라이", "달걀프라이", "삶은계란", "삶은달걀"] },
    { tokens: ["고구마"], patterns: ["고구마", "찐고구마", "삶은고구마"] },
    { tokens: ["감자"], patterns: ["감자", "찐감자", "삶은감자"] },
    { tokens: ["바나나"], patterns: ["바나나", "banana"] },
  ];

  rules.forEach((rule) => {
    if (!rule.patterns.some((pattern) => text.includes(normalize(pattern)))) return;
    rule.tokens.forEach(add);
  });

  // 한국어 식단 입력에서 "가슴살"은 대부분 닭가슴살 의미로 쓰이므로 후보 추천에서만 닭+가슴으로 해석한다.
  // 자동 계산은 여전히 사용자가 직접 연결한 user_aliases가 있어야만 된다.
  if (text.includes("닭찌")) {
    add("닭");
    add("가슴");
    add("가슴살");
  }

  if (text.includes("가슴살") && !tokens.includes("닭") && !tokens.includes("소") && !tokens.includes("돼지") && !tokens.includes("오리")) {
    add("닭");
    add("닭고기");
  }

  if (text.includes("목살") && !tokens.includes("돼지") && !tokens.includes("소")) {
    add("돼지");
    add("돼지고기");
    add("목심");
  }

  if (text.includes("등심") && !tokens.includes("소") && !tokens.includes("돼지")) {
    add("소");
    add("소고기");
    add("쇠고기");
    add("한우");
  }

  return tokens;
}

export const FOOD_CANDIDATE_SYNONYM_GROUPS = [
  ["계란", "달걀"],
  ["밥", "쌀밥", "백미밥", "흰밥", "공기밥", "햇반"],
  ["닭가슴살", "닭고기가슴", "가슴살", "닭찌", "닭찌찌", "닭가"],
  ["소고기", "쇠고기", "한우"],
  ["돼지고기", "돼지"],
  ["목살", "목심"],
  ["삼겹살", "삼겹"],
  ["등심", "소고기등심", "쇠고기등심"],
  ["고구마", "찐고구마", "삶은고구마"],
  ["감자", "찐감자", "삶은감자"],
  ["바나나", "banana"],
];

export function getFoodCandidateSearchNames(name) {
  const cleanName = cleanFoodName(name);
  const normalizedName = normalize(cleanName);
  if (!normalizedName) return [];

  const names = [cleanName];

  FOOD_CANDIDATE_SYNONYM_GROUPS.forEach((group) => {
    const normalizedGroup = group.map(normalize);
    const matchedKeywords = group.filter((keyword, index) => normalizedName.includes(normalizedGroup[index]));
    if (matchedKeywords.length === 0) return;

    group.forEach((keyword) => names.push(keyword));

    matchedKeywords.forEach((keyword) => {
      group.forEach((replacement) => {
        if (normalize(keyword) === normalize(replacement)) return;
        names.push(cleanName.replaceAll(keyword, replacement));
      });
    });
  });

  if (normalizedName.includes("가슴살") && !normalizedName.includes("닭") && !normalizedName.includes("소") && !normalizedName.includes("돼지") && !normalizedName.includes("오리")) {
    names.push("닭가슴살", "닭고기가슴");
  }

  if (normalizedName.includes("목살") && !normalizedName.includes("돼지") && !normalizedName.includes("소")) {
    names.push("돼지고기목살", "돼지고기목심");
  }

  if (normalizedName.includes("등심") && !normalizedName.includes("소") && !normalizedName.includes("돼지")) {
    names.push("소고기등심", "쇠고기등심", "한우등심");
  }

  return [...new Set(names.map(cleanFoodName).filter(Boolean))];
}

export function cleanFoodName(value) {
  return String(value).replace(/\s/g, "").trim();
}

export function splitMemoPreviewFoodName(value) {
  const displayName = String(value || "").trim();

  const parenMatch = displayName.match(/^(.+?)(\(.+\))$/);
  if (parenMatch) {
    return {
      main: parenMatch[1],
      sub: parenMatch[2],
    };
  }

  return {
    main: displayName,
    sub: "",
  };
}

export function getBuiltInAliasFoods() {
  return [];
}

export function getManagedUserFoods(customFoods) {
  const seen = new Set();

  return Object.values(customFoods || {})
    .filter((food) => {
      if (!food) return false;

      // alias가 같은 이름의 user_food를 덮어쓴 경우에도 직접 등록 음식 탭에서 최소 1번은 보이게 한다.
      if (food.source === "user_alias") {
        return Boolean(food.userFoodId) && normalize(food.name) === normalize(food.canonicalName || food.name);
      }

      return food.source === "user_food" || Boolean(food.userFoodId) || String(food.id || "").startsWith("custom-");
    })
    .map((food) => {
      if (food.source !== "user_alias") return food;
      return {
        ...food,
        id: "user-" + (food.userFoodId || normalize(food.canonicalName || food.name)),
        name: food.canonicalName || food.name,
        canonicalName: "",
        source: "user_food",
      };
    })
    .filter((food) => {
      const key = food.userFoodId ? "id:" + food.userFoodId : "name:" + normalize(food.name);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => getFoodDisplayName(a).localeCompare(getFoodDisplayName(b), "ko-KR"));
}

export function getManagedUserAliases(customFoods) {
  const seen = new Set();

  return Object.values(customFoods || {})
    .filter((food) => food?.source === "user_alias")
    .filter((alias) => {
      const key = alias.aliasId ? "id:" + alias.aliasId : "name:" + normalize(alias.name);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => cleanFoodName(a.name).localeCompare(cleanFoodName(b.name), "ko-KR"));
}

export function getFoodTargetIds(food) {
  if (!food) return { appFoodId: null, userFoodId: null };

  const appFoodId = food.appFoodId || food.app_food_id || (String(food.id || "").startsWith("app-") ? String(food.id).replace("app-", "") : null);
  const userFoodId = food.userFoodId || food.user_food_id || (String(food.id || "").startsWith("user-") ? String(food.id).replace("user-", "") : null);

  return {
    appFoodId: appFoodId && /^\d+$/.test(String(appFoodId)) ? Number(appFoodId) : null,
    userFoodId: userFoodId && /^\d+$/.test(String(userFoodId)) ? Number(userFoodId) : null,
  };
}

export function isSameFoodTarget(food, ids) {
  const foodIds = getFoodTargetIds(food);
  if (ids.appFoodId && foodIds.appFoodId && String(ids.appFoodId) === String(foodIds.appFoodId)) return true;
  if (ids.userFoodId && foodIds.userFoodId && String(ids.userFoodId) === String(foodIds.userFoodId)) return true;
  return false;
}

export function getUnitDisplayFoodName(food) {
  const aliasName = cleanFoodName(food?.aliasText || food?.name || "");
  const targetName = cleanFoodName(food?.canonicalName || getFoodDisplayName(food));

  if (food?.source === "user_alias" && aliasName && targetName && normalize(aliasName) !== normalize(targetName)) {
    return aliasName + "(" + targetName + ")";
  }

  return targetName || aliasName;
}

export function getUnitDisplayPriority(food) {
  if (food?.source === "user_alias") return 3;
  if (food?.source === "user_food" || food?.userFoodId) return 2;
  return 1;
}

export function getManagedUserUnits(customFoods) {
  const unitsByKey = new Map();

  Object.values(customFoods || {}).forEach((food) => {
    (food?.units || []).forEach((unit) => {
      if (unit?.source !== "user" && !unit?.userUnitId) return;

      const targetIds = getFoodTargetIds(food);
      const key = unit.userUnitId
        ? "id:" + unit.userUnitId
        : [targetIds.appFoodId || "", targetIds.userFoodId || "", normalize(unit.unitName)].join("::");

      if (!key) return;

      const candidate = {
        ...unit,
        foodName: getUnitDisplayFoodName(food),
        targetFood: food,
        targetType: food?.source === "user_food" || food?.userFoodId ? "user_food" : "app_food",
        displayPriority: getUnitDisplayPriority(food),
      };

      const previous = unitsByKey.get(key);
      if (!previous || candidate.displayPriority > previous.displayPriority) {
        unitsByKey.set(key, candidate);
      }
    });
  });

  return Array.from(unitsByKey.values()).sort((a, b) => {
    const foodCompare = cleanFoodName(a.foodName).localeCompare(cleanFoodName(b.foodName), "ko-KR");
    if (foodCompare !== 0) return foodCompare;
    return cleanFoodName(a.unitName).localeCompare(cleanFoodName(b.unitName), "ko-KR");
  });
}

export function getUnitTargetTypeLabel(unit) {
  return unit?.targetType === "user_food" || unit?.userFoodId ? "직접 등록 음식" : "표준 음식";
}

export function mergeUserFoodUnitIntoMap(currentFoods, targetFood, unitRow) {
  const unit = toFoodUnitEntry(unitRow, "user");
  const ids = getFoodTargetIds(targetFood || unit);
  const nextFoods = { ...currentFoods };

  Object.entries(nextFoods).forEach(([key, food]) => {
    if (!isSameFoodTarget(food, ids)) return;

    const previousUnits = Array.isArray(food.units) ? food.units : [];
    const nextUnits = [
      unit,
      ...previousUnits.filter((entry) => {
        if (unit.userUnitId && entry.userUnitId && String(entry.userUnitId) === String(unit.userUnitId)) return false;
        return !(entry.source === "user" && normalize(entry.unitName) === normalize(unit.unitName));
      }),
    ];

    nextFoods[key] = { ...food, units: nextUnits };
  });

  return nextFoods;
}

export function removeUserFoodUnitFromMap(currentFoods, unitToRemove) {
  const ids = getFoodTargetIds(unitToRemove?.targetFood || unitToRemove);
  const unitId = unitToRemove?.userUnitId || unitToRemove?.user_unit_id || null;
  const unitName = normalize(unitToRemove?.unitName || unitToRemove?.unit_name || "");
  const nextFoods = { ...currentFoods };

  Object.entries(nextFoods).forEach(([key, food]) => {
    if (!isSameFoodTarget(food, ids)) return;

    nextFoods[key] = {
      ...food,
      units: (food.units || []).filter((entry) => {
        if (unitId && entry.userUnitId && String(entry.userUnitId) === String(unitId)) return false;
        return !(entry.source === "user" && unitName && normalize(entry.unitName) === unitName);
      }),
    };
  });

  return nextFoods;
}

export function getAliasTargetTypeLabel(alias) {
  return alias?.userFoodId || alias?.aliasTargetSource === "user_food" ? "직접 등록 음식" : "표준 음식";
}

export function removeManagedAliasFromMap(currentFoods, aliasToRemove) {
  const nextFoods = { ...currentFoods };
  const aliasKey = normalize(aliasToRemove?.aliasText || aliasToRemove?.name || "");

  if (aliasKey) delete nextFoods[aliasKey];

  // 같은 이름 alias가 user_food를 덮어쓴 상태였다면, 별칭 삭제 후에도 직접 등록 음식은 남겨둔다.
  if (aliasToRemove?.userFoodId) {
    const restoredName = cleanFoodName(aliasToRemove.canonicalName || aliasToRemove.name || "");
    const restoredKey = normalize(restoredName);

    if (restoredKey && !nextFoods[restoredKey]) {
      nextFoods[restoredKey] = {
        ...aliasToRemove,
        id: "user-" + aliasToRemove.userFoodId,
        name: restoredName,
        canonicalName: "",
        source: "user_food",
      };
    }
  }

  return nextFoods;
}

export function makeUserFoodFormFromFood(food) {
  return {
    name: getFoodDisplayName(food),
    baseAmount: "100",
    kcal: food ? String(Math.round(toNumber(food.kcal))) : "",
    carb: food ? formatMacro(toNumber(food.carb)) : "",
    protein: food ? formatMacro(toNumber(food.protein)) : "",
    fat: food ? formatMacro(toNumber(food.fat)) : "",
  };
}

export function getPreparedUserFoodFromForm(form) {
  const foodName = cleanFoodName(form.name);
  const baseAmount = toNumber(form.baseAmount) || 100;
  const per100Rate = baseAmount > 0 ? 100 / baseAmount : 1;

  return {
    id: "custom-" + normalize(foodName),
    name: foodName,
    kcal: toNumber(form.kcal) * per100Rate,
    carb: toNumber(form.carb) * per100Rate,
    protein: toNumber(form.protein) * per100Rate,
    fat: toNumber(form.fat) * per100Rate,
    source: "user_food",
    base_amount: 100,
    base_unit: "g",
  };
}

export function mergeManagedUserFood(currentFoods, previousFood, storedFood) {
  const nextFoods = { ...currentFoods };
  const previousKey = normalize(previousFood?.name || "");
  const nextKey = normalize(storedFood?.name || "");

  if (previousKey && previousKey !== nextKey) {
    delete nextFoods[previousKey];
  }

  if (nextKey) {
    nextFoods[nextKey] = storedFood;
  }

  if (previousFood?.userFoodId) {
    Object.entries(nextFoods).forEach(([key, food]) => {
      if (food?.source !== "user_alias") return;
      if (String(food.userFoodId) !== String(previousFood.userFoodId)) return;

      nextFoods[key] = {
        ...food,
        userFoodId: storedFood.userFoodId || food.userFoodId,
        canonicalName: getFoodDisplayName(storedFood),
        kcal: storedFood.kcal,
        carb: storedFood.carb,
        protein: storedFood.protein,
        fat: storedFood.fat,
      };
    });
  }

  return nextFoods;
}

export function removeManagedUserFoodFromMap(currentFoods, foodToRemove) {
  const nextFoods = { ...currentFoods };
  const removeKey = normalize(foodToRemove?.name || "");
  const removeUserFoodId = foodToRemove?.userFoodId || null;

  Object.entries(nextFoods).forEach(([key, food]) => {
    const sameName = removeKey && normalize(food?.name || "") === removeKey;
    const sameUserFood = removeUserFoodId && String(food?.userFoodId || "") === String(removeUserFoodId);
    if (sameName || sameUserFood) delete nextFoods[key];
  });

  return nextFoods;
}

export function getFoodPool(customFoods) {
  return Object.values(customFoods || {});
}

export function getFoodDisplayName(food) {
  return cleanFoodName(food?.canonicalName || food?.name || "");
}

export function getFoodMatchKey(food) {
  return normalize(food?.canonicalName || food?.normalizedName || food?.name || "");
}

export function getFoodExactKeys(food) {
  return [
    food?.name,
    food?.canonicalName,
    food?.normalizedName,
    getFoodDisplayName(food),
  ]
    .map((value) => normalize(value || ""))
    .filter(Boolean);
}

export function findExactFoodByName(name, customFoods) {
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

export function getFoodSearchTermEntries(food) {
  return (food?.searchTerms || [])
    .map((term) => ({
      ...term,
      normalized: normalize(term.normalized || term.text || ""),
      weight: toNumber(term.weight) || 50,
    }))
    .filter((term) => term.normalized);
}

export function getFoodSearchableNames(food) {
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

export function isLooseFoodSearchAllowed(normalizedName) {
  // 한 글자 includes는 후보가 너무 많이 뜬다. 단, "밥"은 식단 앱에서 의미가 명확해서 예외로 둔다.
  return normalizedName.length >= 2 || normalizedName === "밥";
}

export function getFoodMatchInfo(food, normalizedName) {
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

export function dedupeFoodMatches(matches) {
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

export function findFoodMatches(name, customFoods) {
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

export function findFoodMatchesExpanded(name, customFoods) {
  if (!normalize(name)) return [];

  const exactFood = findExactFoodByName(name, customFoods);
  const expandedMatches = getFoodCandidateSearchNames(name)
    .flatMap((searchName) => findFoodMatches(searchName, customFoods));

  return dedupeFoodMatches([exactFood, ...expandedMatches].filter(Boolean));
}

export function getFoodPreviewTitle(food) {
  return food?.displayName || getFoodDisplayName(food);
}

export function findFoodByName(name, customFoods) {
  return findExactFoodByName(name, customFoods);
}

export function applyFoodBasisToItem(item, food) {
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

export function getFoodBasisSnapshotFromItem(item) {
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

export function buildMemoBasisMapFromMeals(meals) {
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

export function resolveItem(item, customFoods) {
  const food = findFoodByName(item.name, customFoods);
  return applyFoodBasisToItem(item, food);
}

export function getMemoBasisKey(rowIndex, segmentIndex, entryIndex = 0) {
  return [rowIndex, segmentIndex, entryIndex].join(":");
}

export function getMemoSegmentIndex(foods, cursor) {
  return String(foods || "")
    .slice(0, Math.max(0, cursor))
    .split(/[，,]/).length - 1;
}

export function getMemoFoodBasis(basisMap, rowIndex, segmentIndex, entryIndex, name) {
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

export function getFoodUnitAliases(unit) {
  return [unit?.unitName, ...(unit?.aliases || [])]
    .map((value) => normalize(value || ""))
    .filter(Boolean);
}

export function findFoodUnit(food, unitText) {
  const normalizedUnit = normalize(unitText);
  if (!normalizedUnit) return null;

  if (["g", "그램"].includes(normalizedUnit)) {
    return { unitName: "g", grams: 1, aliases: ["g", "그램"] };
  }

  return (food?.units || []).find((unit) => getFoodUnitAliases(unit).includes(normalizedUnit)) || null;
}

export function isEggUnitInput(name, unitText) {
  const normalizedName = normalize(name);
  const normalizedUnit = normalize(unitText);
  return ["개", "알"].includes(normalizedUnit) && ["계란", "달걀"].some((keyword) => normalizedName.includes(keyword));
}

export function findFoodForUnitAmount(name, unitText, customFoods, basisFood) {
  if (basisFood) return basisFood;

  const exactFood = findFoodByName(name, customFoods);
  if (exactFood && findFoodUnit(exactFood, unitText)) return exactFood;

  // 계란/달걀의 개·알 단위는 앱 공통 단위로 허용한다.
  // food_search_terms는 일반 자동 확정에는 쓰지 않지만, 계란 단위 입력만 예외적으로 후보 중 단위가 있는 음식을 사용한다.
  if (isEggUnitInput(name, unitText)) {
    return findFoodMatchesExpanded(name, customFoods).find((food) => findFoodUnit(food, unitText)) || exactFood || null;
  }

  return exactFood;
}
