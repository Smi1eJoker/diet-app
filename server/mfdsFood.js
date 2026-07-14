const MFDS_ENDPOINT = "https://apis.data.go.kr/1471000/FoodNtrCpntDbInfo02/getFoodNtrCpntDbInq02";

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeFoodName(value) {
  return cleanText(value)
    .toLocaleLowerCase("ko-KR")
    .replace(/[^0-9a-z가-힣]+/g, "");
}

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === "") return 0;
  const number = Number(String(value).replace(/,/g, "").replace(/[^0-9.+-]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function parseServingAmount(value) {
  const amount = toFiniteNumber(value);
  return amount > 0 ? amount : 100;
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function roundNutrient(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function mostCommonText(values) {
  const counts = new Map();
  values.map(cleanText).filter(Boolean).forEach((value) => {
    counts.set(value, (counts.get(value) || 0) + 1);
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko"))[0]?.[0] || "";
}

function getItems(payload) {
  const body = payload?.response?.body ?? payload?.body ?? payload;
  const items = body?.items?.item ?? body?.items ?? body?.item ?? [];
  if (Array.isArray(items)) return items;
  return items && typeof items === "object" ? [items] : [];
}

function getApiError(payload) {
  const header = payload?.response?.header ?? payload?.header ?? {};
  const resultCode = cleanText(header.resultCode || header.result_code);
  const resultMessage = cleanText(header.resultMsg || header.result_message);
  if (resultCode && resultCode !== "00" && resultCode !== "0" && resultCode !== "NORMAL_SERVICE") {
    return resultMessage || `식약처 API 오류(${resultCode})`;
  }
  return "";
}

function toPer100(value, servingAmount) {
  if (!servingAmount) return 0;
  return toFiniteNumber(value) * (100 / servingAmount);
}

export function mapMfdsItem(row) {
  const name = cleanText(row?.FOOD_NM_KR || row?.foodNmKr || row?.DESC_KOR || row?.food_name);
  if (!name) return null;

  const servingAmount = parseServingAmount(
    row?.NUTRI_AMOUNT_SERVING || row?.SERVING_SIZE || row?.nutriAmountServing || row?.serving_size
  );

  const kcal = toPer100(row?.AMT_NUM1 ?? row?.NUTR_CONT1 ?? row?.kcal, servingAmount);
  const protein = toPer100(row?.AMT_NUM3 ?? row?.NUTR_CONT3 ?? row?.protein, servingAmount);
  const fat = toPer100(row?.AMT_NUM4 ?? row?.NUTR_CONT4 ?? row?.fat, servingAmount);
  const carb = toPer100(row?.AMT_NUM6 ?? row?.NUTR_CONT2 ?? row?.carb, servingAmount);

  if (![kcal, carb, protein, fat].some((value) => value > 0)) return null;
  if (kcal < 0 || kcal > 1500 || carb < 0 || protein < 0 || fat < 0) return null;

  return {
    name,
    normalizedName: normalizeFoodName(name),
    sourceFoodCode: cleanText(row?.FOOD_CD || row?.ITEM_REPORT_NO || row?.NUM),
    category: cleanText(row?.FOOD_CAT1_NM || row?.DB_GRP_NM || row?.GROUP_NAME),
    subCategory: cleanText(row?.FOOD_CAT2_NM || row?.FOOD_CAT3_NM || row?.FOOD_CAT4_NM),
    maker: cleanText(row?.MAKER_NM || row?.SELLER_MANUFAC_NM || row?.IMP_MANUFAC_NM || row?.MAKER_NAME),
    originName: cleanText(row?.FOOD_OR_NM || row?.FOOD_REF_NM),
    kcal: roundNutrient(kcal),
    carb: roundNutrient(carb),
    protein: roundNutrient(protein),
    fat: roundNutrient(fat),
  };
}

function scoreName(name, query) {
  const normalizedName = normalizeFoodName(name);
  const normalizedQuery = normalizeFoodName(query);
  if (!normalizedQuery) return 0;
  if (normalizedName === normalizedQuery) return 1000;
  if (normalizedName.startsWith(normalizedQuery)) return 700;
  if (normalizedName.includes(normalizedQuery)) return 500;
  return 0;
}

export function groupMfdsFoods(items, query = "", limit = 20) {
  const mapped = items.map(mapMfdsItem).filter(Boolean);
  const groups = new Map();

  mapped.forEach((food) => {
    const key = food.normalizedName;
    if (!key) return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(food);
  });

  return [...groups.values()]
    .map((foods) => {
      const representativeName = mostCommonText(foods.map((food) => food.name));
      const kcalValues = foods.map((food) => food.kcal);
      const carbValues = foods.map((food) => food.carb);
      const proteinValues = foods.map((food) => food.protein);
      const fatValues = foods.map((food) => food.fat);
      const sourceCodes = foods.map((food) => food.sourceFoodCode).filter(Boolean);

      return {
        id: `mfds-${normalizeFoodName(representativeName)}`,
        externalFoodId: sourceCodes[0] || normalizeFoodName(representativeName),
        sourceFoodCode: sourceCodes[0] || "",
        name: representativeName,
        canonicalName: representativeName,
        displayName: representativeName,
        category: mostCommonText(foods.map((food) => food.category)),
        subCategory: mostCommonText(foods.map((food) => food.subCategory)),
        maker: mostCommonText(foods.map((food) => food.maker)),
        originName: mostCommonText(foods.map((food) => food.originName)),
        baseAmount: 100,
        basisUnit: "g",
        kcal: roundNutrient(median(kcalValues), 1),
        carb: roundNutrient(median(carbValues)),
        protein: roundNutrient(median(proteinValues)),
        fat: roundNutrient(median(fatValues)),
        kcalMin: roundNutrient(Math.min(...kcalValues), 1),
        kcalMax: roundNutrient(Math.max(...kcalValues), 1),
        sampleCount: foods.length,
        source: "mfds_api",
        sourceLabel: foods.length > 1 ? `식약처 ${foods.length}건 대표값` : "식약처 식품영양성분 DB",
        score: scoreName(representativeName, query),
      };
    })
    .filter((food) => food.score > 0 || !normalizeFoodName(query))
    .sort((a, b) => b.score - a.score || b.sampleCount - a.sampleCount || a.name.localeCompare(b.name, "ko"))
    .slice(0, Math.min(Math.max(Number(limit) || 20, 1), 50))
    .map((food) => {
      const result = { ...food };
      delete result.score;
      return result;
    });
}

function encodeServiceKey(apiKey) {
  const key = cleanText(apiKey);
  return /%[0-9a-f]{2}/i.test(key) ? key : encodeURIComponent(key);
}

export async function searchMfdsFoods({ query, limit = 20, apiKey, fetchImpl = fetch }) {
  const keyword = cleanText(query);
  if (!keyword) return [];
  if (!cleanText(apiKey)) {
    throw new Error("식약처 API 인증키가 설정되지 않았어. MFDS_API_KEY를 등록해줘.");
  }

  const params = new URLSearchParams({
    type: "json",
    FOOD_NM_KR: keyword,
    pageNo: "1",
    numOfRows: "100",
  });
  const url = `${MFDS_ENDPOINT}?serviceKey=${encodeServiceKey(apiKey)}&${params.toString()}`;
  const response = await fetchImpl(url, { headers: { Accept: "application/json" } });
  const text = await response.text();

  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error("식약처 API 응답을 해석하지 못했어.");
  }

  if (!response.ok) {
    throw new Error(getApiError(payload) || `식약처 API 조회에 실패했어. (${response.status})`);
  }

  const apiError = getApiError(payload);
  if (apiError) throw new Error(apiError);

  return groupMfdsFoods(getItems(payload), keyword, limit);
}
