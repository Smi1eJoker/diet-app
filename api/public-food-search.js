const SERVICE_ID = "I0750";
const DATA_TYPE = "json";
const START_INDEX = 1;
const END_INDEX = 30;

function toNumber(value) {
  if (value === null || value === undefined) return 0;
  const text = String(value).trim();
  if (!text || text.toUpperCase() === "N/A") return 0;
  const parsed = Number(text.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundOne(value) {
  const number = toNumber(value);
  return Math.round(number * 10) / 10;
}

function getKeyForPath(rawKey) {
  const trimmedKey = String(rawKey || "").trim();
  if (!trimmedKey) return "";

  try {
    return encodeURIComponent(decodeURIComponent(trimmedKey));
  } catch {
    return encodeURIComponent(trimmedKey);
  }
}

function normalizeMfdsFood(row) {
  const servingWeight = toNumber(row.SERVING_WT) || 100;
  const ratio = servingWeight > 0 ? 100 / servingWeight : 1;

  return {
    source: "mfds_I0750",
    sourceFoodCode: row.FOOD_CD || "",
    name: row.DESC_KOR || "",
    maker: row.ANIMAL_PLANT || "",
    category: row.FDGRP_NM || row.FOOD_GROUP || "",
    baseAmount: "100g",

    kcalPer100g: roundOne(toNumber(row.NUTR_CONT1) * ratio),
    carbPer100g: roundOne(toNumber(row.NUTR_CONT2) * ratio),
    proteinPer100g: roundOne(toNumber(row.NUTR_CONT3) * ratio),
    fatPer100g: roundOne(toNumber(row.NUTR_CONT4) * ratio),

    sugarPer100g: roundOne(toNumber(row.NUTR_CONT5) * ratio),
    sodiumPer100g: roundOne(toNumber(row.NUTR_CONT6) * ratio),
    saturatedFatPer100g: roundOne(toNumber(row.NUTR_CONT8) * ratio),
    transFatPer100g: roundOne(toNumber(row.NUTR_CONT9) * ratio),

    servingSize: servingWeight ? `${servingWeight}g` : "",
    dataDate: row.BGN_YEAR || "",
    raw: row,
  };
}

function getMfdsRows(payload) {
  const body = payload?.[SERVICE_ID];
  if (!body) return [];
  const rows = body.row || [];
  return Array.isArray(rows) ? rows : [rows];
}

function getMfdsResult(payload) {
  return payload?.[SERVICE_ID]?.RESULT || null;
}

export default async function handler(req, res) {
  try {
    const query = String(req.query.q || "").trim();
    const serviceKey = getKeyForPath(process.env.PUBLIC_DATA_SERVICE_KEY);

    if (!query) {
      return res.status(400).json({ error: "검색어가 필요합니다." });
    }

    if (!serviceKey) {
      return res.status(500).json({ error: "PUBLIC_DATA_SERVICE_KEY가 설정되지 않았습니다." });
    }

    const encodedQuery = encodeURIComponent(query);
    const requestUrl =
      `http://openapi.foodsafetykorea.go.kr/api/${serviceKey}/${SERVICE_ID}/${DATA_TYPE}/${START_INDEX}/${END_INDEX}/DESC_KOR=${encodedQuery}`;

    const response = await fetch(requestUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    const text = await response.text();
    let payload = null;

    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      return res.status(502).json({
        error: "식약처 API 응답이 JSON이 아닙니다.",
        detail: text.slice(0, 300),
      });
    }

    if (!response.ok) {
      return res.status(response.status).json({
        error: "식약처 API 조회에 실패했습니다.",
        detail: payload,
      });
    }

    const result = getMfdsResult(payload);
    const code = result?.CODE || "";
    const message = result?.MSG || "";

    if (code && code !== "INFO-000" && code !== "INFO-200") {
      return res.status(502).json({
        error: "식약처 API 조회에 실패했습니다.",
        code,
        message,
      });
    }

    const foods = getMfdsRows(payload)
      .map(normalizeMfdsFood)
      .filter((food) => food.name)
      .slice(0, 30);

    return res.status(200).json({
      query,
      foods,
      source: "mfds_I0750",
      code: code || "INFO-000",
      message,
    });
  } catch (error) {
    return res.status(500).json({
      error: "공공데이터 조회 중 오류가 발생했습니다.",
      detail: error.message,
    });
  }
}
