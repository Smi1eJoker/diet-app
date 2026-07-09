const MFDS_SERVICE_ID = "I0750";
const MFDS_SOURCE = "mfds_nutrition_db";
const MFDS_SOURCE_LABEL = "식약처 식품영양성분DB";
const MFDS_API_BASE = "https://openapi.foodsafetykorea.go.kr/api";
const DEFAULT_PAGE_SIZE = 40;

function toNumber(value) {
  if (value === null || value === undefined) return 0;
  const text = String(value)
    .replace(/,/g, "")
    .replace(/N\/A/gi, "")
    .replace(/[^0-9.+-]/g, "")
    .trim();

  if (!text) return 0;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalize(value) {
  return String(value || "")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^0-9a-z가-힣]+/g, "");
}

function pick(row, keys) {
  for (const key of keys) {
    if (row?.[key] !== undefined && row?.[key] !== null && row?.[key] !== "") return row[key];
  }
  return "";
}

function per100(value, servingWeight) {
  const amount = toNumber(value);
  const weight = toNumber(servingWeight) || 100;

  if (amount <= 0 || weight <= 0) return 0;
  return amount * 100 / weight;
}

function roundOne(value) {
  const number = toNumber(value);
  return Math.round(number * 10) / 10;
}

function getMfdsPayload(data) {
  return data?.[MFDS_SERVICE_ID] || data?.I0750 || data?.body || data || {};
}

function getMfdsRows(data) {
  const payload = getMfdsPayload(data);
  const rows = payload?.row || payload?.rows || payload?.items || [];
  return Array.isArray(rows) ? rows : rows ? [rows] : [];
}

function getMfdsResult(data) {
  const payload = getMfdsPayload(data);
  return payload?.RESULT || data?.RESULT || {};
}

function buildMfdsUrl(query) {
  const serviceKey = String(process.env.PUBLIC_DATA_SERVICE_KEY || "").trim();
  const encodedServiceKey = encodeURIComponent(serviceKey);
  const startIndex = 1;
  const endIndex = DEFAULT_PAGE_SIZE;
  const filter = new URLSearchParams({ DESC_KOR: query }).toString();

  return `${MFDS_API_BASE}/${encodedServiceKey}/${MFDS_SERVICE_ID}/json/${startIndex}/${endIndex}/${filter}`;
}

function normalizeMfdsFood(row) {
  const name = String(pick(row, ["DESC_KOR", "desc_kor", "foodNm", "foodName", "name"])).trim();
  if (!name) return null;

  const servingWeight = toNumber(pick(row, ["SERVING_WT", "serving_wt", "servingWeight", "servingSize"]));
  const sourceFoodCode = String(pick(row, ["FOOD_CD", "food_cd", "foodCd", "foodCode"])).trim();
  const maker = String(pick(row, ["ANIMAL_PLANT", "animal_plant", "mfrNm", "makerNm"])).trim();
  const category = String(pick(row, ["FDGRP_NM", "fdgrp_nm", "foodGroup", "category"])).trim();
  const dataYear = String(pick(row, ["BGN_YEAR", "bgn_year", "year"])).trim();
  const dataSource = String(pick(row, ["FOOD_GROUP", "food_group", "sourceName"])).trim();

  return {
    id: [MFDS_SOURCE, sourceFoodCode || normalize(name), dataYear || "latest"].join("-"),
    source: MFDS_SOURCE,
    sourceLabel: MFDS_SOURCE_LABEL,
    sourceFoodCode,
    name,
    maker,
    category,
    baseAmount: "100g",
    kcalPer100g: roundOne(per100(pick(row, ["NUTR_CONT1", "nutr_cont1"]), servingWeight)),
    carbPer100g: roundOne(per100(pick(row, ["NUTR_CONT2", "nutr_cont2"]), servingWeight)),
    proteinPer100g: roundOne(per100(pick(row, ["NUTR_CONT3", "nutr_cont3"]), servingWeight)),
    fatPer100g: roundOne(per100(pick(row, ["NUTR_CONT4", "nutr_cont4"]), servingWeight)),
    sugarPer100g: roundOne(per100(pick(row, ["NUTR_CONT5", "nutr_cont5"]), servingWeight)),
    sodiumPer100g: roundOne(per100(pick(row, ["NUTR_CONT6", "nutr_cont6"]), servingWeight)),
    cholesterolPer100g: roundOne(per100(pick(row, ["NUTR_CONT7", "nutr_cont7"]), servingWeight)),
    saturatedFatPer100g: roundOne(per100(pick(row, ["NUTR_CONT8", "nutr_cont8"]), servingWeight)),
    transFatPer100g: roundOne(per100(pick(row, ["NUTR_CONT9", "nutr_cont9"]), servingWeight)),
    servingSize: servingWeight > 0 ? `${servingWeight}g` : "",
    dataDate: dataYear,
    dataSource,
    raw: row,
  };
}

function getMatchScore(food, query) {
  const foodName = normalize(food.name);
  const keyword = normalize(query);
  const year = toNumber(food.dataDate);

  let score = year;
  if (keyword && foodName === keyword) score += 100000;
  else if (keyword && foodName.startsWith(keyword)) score += 50000;
  else if (keyword && foodName.includes(keyword)) score += 20000;

  if (food.maker) score += 100;
  if (food.kcalPer100g > 0) score += 50;

  return score;
}

function dedupeFoods(foods, query) {
  const bestByKey = new Map();

  foods.forEach((food) => {
    const key = food.sourceFoodCode || `${normalize(food.name)}-${normalize(food.maker)}`;
    const current = bestByKey.get(key);

    if (!current || getMatchScore(food, query) > getMatchScore(current, query)) {
      bestByKey.set(key, food);
    }
  });

  return Array.from(bestByKey.values())
    .sort((a, b) => getMatchScore(b, query) - getMatchScore(a, query));
}

async function fetchMfdsFoods(query) {
  const url = buildMfdsUrl(query);
  const response = await fetch(url);
  const text = await response.text();

  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error("식약처 API 응답을 JSON으로 해석하지 못했습니다.");
  }

  if (!response.ok) {
    throw new Error("식약처 API 오류: " + response.status);
  }

  const result = getMfdsResult(data);
  const resultCode = String(result?.CODE || "").trim();
  const resultMessage = String(result?.MSG || "").trim();

  if (resultCode && resultCode !== "INFO-000" && resultCode !== "INFO-200") {
    throw new Error(resultMessage || "식약처 API 조회에 실패했습니다.");
  }

  if (resultCode === "INFO-200") return [];

  return dedupeFoods(
    getMfdsRows(data)
      .map(normalizeMfdsFood)
      .filter(Boolean)
      .filter((food) => food.kcalPer100g > 0 || food.carbPer100g > 0 || food.proteinPer100g > 0 || food.fatPer100g > 0),
    query,
  );
}

export default async function handler(req, res) {
  try {
    const query = String(req.query?.q || "").trim();

    if (!query) {
      return res.status(400).json({ error: "검색어가 필요합니다." });
    }

    if (!process.env.PUBLIC_DATA_SERVICE_KEY) {
      return res.status(500).json({ error: "PUBLIC_DATA_SERVICE_KEY가 설정되지 않았습니다." });
    }

    const foods = (await fetchMfdsFoods(query)).slice(0, DEFAULT_PAGE_SIZE);

    return res.status(200).json({
      query,
      source: MFDS_SOURCE,
      foods,
    });
  } catch (error) {
    return res.status(500).json({
      error: "공공데이터 조회에 실패했습니다.",
      detail: error?.message || String(error),
    });
  }
}
