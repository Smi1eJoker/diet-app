const ENDPOINTS = [
  {
    source: "public_food",
    label: "음식",
    url: "https://api.data.go.kr/openapi/tn_pubr_public_nutri_food_info_api",
  },
  {
    source: "public_processed",
    label: "가공식품",
    url: "https://api.data.go.kr/openapi/tn_pubr_public_nutri_process_info_api",
  },
  {
    source: "public_material",
    label: "원재료",
    url: "https://api.data.go.kr/openapi/tn_pubr_public_nutri_material_info_api",
  },
];

function toNumber(value) {
  if (value === null || value === undefined) return 0;
  const text = String(value).replace(/,/g, "").replace(/[^0-9.+-]/g, "").trim();
  if (!text) return 0;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function pick(row, keys) {
  for (const key of keys) {
    if (row?.[key] !== undefined && row?.[key] !== null && row?.[key] !== "") return row[key];
  }
  return "";
}

function normalizeItems(data) {
  const candidates = [
    data?.response?.body?.items?.item,
    data?.response?.body?.items,
    data?.body?.items?.item,
    data?.items?.item,
    data?.items,
  ];

  const found = candidates.find((entry) => entry !== undefined && entry !== null);
  if (!found) return [];
  return Array.isArray(found) ? found : [found];
}

function normalizeFood(row, endpoint) {
  const name = String(pick(row, ["foodNm", "foodName", "food_nm", "FOOD_NM", "name"])).trim();
  if (!name) return null;

  const sourceFoodCode = String(pick(row, ["foodCd", "foodCode", "food_cd", "FOOD_CD", "id"])).trim();
  const maker = String(pick(row, ["mfrNm", "makerNm", "manufacturer", "restNm", "distNm", "mkrNm"])).trim();
  const category = String(pick(row, ["typeNm", "foodLv3Nm", "foodLv4Nm", "foodGrpNm", "foodCategory", "category"])).trim();
  const baseAmount = String(pick(row, ["nutConSrtrQua", "nutrContSrtrQua", "servingSize", "servSize", "foodSize"])).trim() || "100g";

  return {
    id: [endpoint.source, sourceFoodCode || name].join("-"),
    source: endpoint.source,
    sourceLabel: endpoint.label,
    sourceFoodCode,
    name,
    maker,
    category,
    baseAmount,
    kcalPer100g: toNumber(pick(row, ["enerc", "energy", "kcal", "kcalPer100g"])),
    carbPer100g: toNumber(pick(row, ["chocdf", "carb", "carbohydrate", "carbPer100g"])),
    proteinPer100g: toNumber(pick(row, ["prot", "protein", "proteinPer100g"])),
    fatPer100g: toNumber(pick(row, ["fatce", "fat", "fatPer100g"])),
    sugarPer100g: toNumber(pick(row, ["sugar", "sugarPer100g"])),
    sodiumPer100g: toNumber(pick(row, ["nat", "sodium", "sodiumPer100g"])),
    saturatedFatPer100g: toNumber(pick(row, ["fasat", "saturatedFat", "saturatedFatPer100g"])),
    transFatPer100g: toNumber(pick(row, ["fatrn", "transFat", "transFatPer100g"])),
    servingSize: String(pick(row, ["servSize", "servingSize", "foodSize"])).trim(),
    dataDate: String(pick(row, ["crtrYmd", "crtYmd", "updateYmd", "dataDate"])).trim(),
    raw: row,
  };
}

async function fetchPublicFood(endpoint, query) {
  const serviceKey = process.env.PUBLIC_DATA_SERVICE_KEY;
  const params = new URLSearchParams({
    pageNo: "1",
    numOfRows: "20",
    type: "json",
    foodNm: query,
  });

  const response = await fetch(`${endpoint.url}?serviceKey=${serviceKey}&${params.toString()}`);
  const text = await response.text();

  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(endpoint.label + " API 응답을 JSON으로 해석하지 못했습니다.");
  }

  if (!response.ok) {
    throw new Error(endpoint.label + " API 오류: " + response.status);
  }

  return normalizeItems(data)
    .map((row) => normalizeFood(row, endpoint))
    .filter(Boolean)
    .filter((food) => food.kcalPer100g > 0 || food.carbPer100g > 0 || food.proteinPer100g > 0 || food.fatPer100g > 0);
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

    const settled = await Promise.allSettled(ENDPOINTS.map((endpoint) => fetchPublicFood(endpoint, query)));
    const foods = settled
      .flatMap((result) => result.status === "fulfilled" ? result.value : [])
      .filter((food, index, list) => {
        const key = `${food.source}-${food.sourceFoodCode || food.name}`;
        return list.findIndex((entry) => `${entry.source}-${entry.sourceFoodCode || entry.name}` === key) === index;
      })
      .slice(0, 40);

    return res.status(200).json({ query, foods });
  } catch (error) {
    return res.status(500).json({
      error: "공공데이터 조회에 실패했습니다.",
      detail: error?.message || String(error),
    });
  }
}
