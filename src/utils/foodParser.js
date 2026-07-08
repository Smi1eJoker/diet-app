import { makeId } from "./id";
import { formatAmount, toNumber } from "./nutrition";
import {
  applyFoodBasisToItem,
  cleanFoodName,
  findFoodByName,
  findFoodForUnitAmount,
  findFoodUnit,
  getMemoFoodBasis,
  normalize,
  resolveItem,
} from "./foodMatch";

export function parseKoreanQuantity(value) {
  const rawText = String(value || "").trim();
  if (!rawText) return null;

  // 소수점 수량을 먼저 처리한다. normalize()는 점을 제거하므로 0.5개가 5개로 깨질 수 있다.
  const numeric = Number(rawText);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;

  const text = normalize(rawText);
  if (!text) return null;

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

export function isLikelyUnitToken(value) {
  return ["개", "알", "공기", "밥공기", "그릇", "줌", "컵", "잔"].includes(normalize(value));
}

export function parseQuantityUnitToken(token) {
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

export function parseQuantityUnitTokens(quantityToken, unitToken) {
  const quantity = parseKoreanQuantity(quantityToken);
  if (quantity && unitToken) {
    return { quantity, unitText: unitToken, consumed: 2 };
  }

  const compact = parseQuantityUnitToken(quantityToken);
  if (compact && compact.quantity > 0 && compact.unitText) return compact;

  return null;
}

export function parseAttachedFoodUnitToken(token) {
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

export function resolveFoodUnitInfo(name, quantity, unitText, customFoods, basisFood) {
  const cleanQuantity = toNumber(quantity);
  if (cleanQuantity <= 0) return null;

  const normalizedUnit = normalize(unitText);
  if (["g", "그램"].includes(normalizedUnit)) {
    return {
      amount: cleanQuantity,
      food: basisFood || findFoodByName(name, customFoods) || null,
    };
  }

  const food = findFoodForUnitAmount(name, unitText, customFoods, basisFood);
  const unit = findFoodUnit(food, unitText);
  if (!unit) return null;

  return {
    amount: cleanQuantity * toNumber(unit.grams),
    food,
  };
}

export function resolveFoodUnitAmount(name, quantity, unitText, customFoods, basisFood) {
  return resolveFoodUnitInfo(name, quantity, unitText, customFoods, basisFood)?.amount ?? null;
}

export function createItem(name, amount, customFoods, rawLine, id, basisFood, displayInfo = {}) {
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

export function parseMemoLine(line, customFoods) {
  const rawLine = line.trim();
  if (!rawLine) return null;

  const entries = parseFoodEntries(rawLine, customFoods);
  return entries[0] || createItem(rawLine, 0, customFoods, rawLine);
}

export function itemToMemoLine(item) {
  const memoName = formatMemoItemName(item.inputName || item.name || "");

  if (item.displayUnit && toNumber(item.displayAmount) > 0) {
    return memoName + " " + formatAmount(toNumber(item.displayAmount)) + item.displayUnit;
  }

  return memoName + (item.amount > 0 ? " " + formatAmount(item.amount) + "g" : "");
}

export function getUnsupportedUnitItem(items) {
  return (items || []).find((item) => item?.unsupportedUnit);
}

export function getUnitWeightOverrideKey(name, unitText) {
  const foodKey = normalize(cleanFoodName(name));
  const unitKey = normalize(unitText);
  return foodKey && unitKey ? foodKey + "::" + unitKey : "";
}

export function getUnitWeightOverride(unitOverrides, name, unitText) {
  const key = getUnitWeightOverrideKey(name, unitText);
  const grams = key ? toNumber(unitOverrides?.[key]) : 0;
  return grams > 0 ? grams : 0;
}

export function createUnitWeightTarget(item, lineNumber) {
  const foodName = cleanFoodName(item?.name || "");
  const unitName = item?.displayUnit || item?.unsupportedUnitName || "";
  const quantity = toNumber(item?.displayAmount) || 1;

  return {
    key: getUnitWeightOverrideKey(foodName, unitName),
    foodName,
    unitName,
    quantity,
    lineNumber,
  };
}

export function createUnsupportedOrOverrideItem(name, quantity, unitText, customFoods, rawLine, basisFood, unitOverrides) {
  const unitGrams = getUnitWeightOverride(unitOverrides, name, unitText);
  if (unitGrams > 0) {
    return createItem(
      name,
      toNumber(quantity) * unitGrams,
      customFoods,
      rawLine,
      undefined,
      basisFood,
      {
        displayAmount: quantity,
        displayUnit: unitText,
        unitGramOverride: unitGrams,
        inputName: String(name || "").trim(),
      }
    );
  }

  return createItem(
    name,
    0,
    customFoods,
    rawLine,
    undefined,
    basisFood,
    {
      displayAmount: quantity,
      displayUnit: unitText,
      unsupportedUnit: true,
      unsupportedUnitName: unitText,
      inputName: String(name || "").trim(),
    }
  );
}

export function makeUnsupportedUnitMessage(item, lineNumber) {
  const foodName = cleanFoodName(item?.name || "이 음식");
  const unitName = item?.displayUnit || item?.unsupportedUnitName || "해당 단위";
  const quantity = toNumber(item?.displayAmount);
  const quantityText = quantity > 0 ? formatAmount(quantity) : "";
  const prefix = lineNumber ? lineNumber + "번째 줄: " : "";

  return prefix + foodName + " " + quantityText + unitName + "는 아직 지원하지 않아. g으로 입력해줘. 예: " + foodName + " 100g";
}

export function mealToDailyMemoLine(meal) {
  const items = meal.items.map((item) => itemToMemoLine(item)).join(", ");
  return meal.time + (items ? "\t" + items : "");
}

export function mealsToDailyMemo(meals) {
  return sortMealsLatestFirst(meals)
    .slice()
    .reverse()
    .map(mealToDailyMemoLine)
    .join("\n");
}

export function buildMemoUnitOverrideMapFromMeals(meals) {
  const overrideMap = {};

  (meals || []).forEach((meal) => {
    (meal.items || []).forEach((item) => {
      const key = getUnitWeightOverrideKey(item.name, item.displayUnit);
      if (!key || toNumber(item.displayAmount) <= 0 || toNumber(item.amount) <= 0) return;

      const unitGrams = toNumber(item.unitGramOverride) || (toNumber(item.amount) / toNumber(item.displayAmount));
      if (unitGrams > 0) overrideMap[key] = unitGrams;
    });
  });

  return overrideMap;
}

export function splitDailyMemoRows(value) {
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

export function appendMemoFoods(existingFoods, addedFoods) {
  const existing = String(existingFoods || "").trim();
  const added = String(addedFoods || "").trim();
  if (!added) return existing;
  return existing ? existing + ", " + added : added;
}

export function buildDailyMemoFromRows(rows) {
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

export function splitFoodSegments(text) {
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

export function normalizeMemoFoodSegment(value) {
  return String(value || "")
    .trim()
    // 모바일 입력/이전 파싱 오류로 "420g"이 "4 20g"처럼 갈라진 경우 복구한다.
    // 예: "밥 4 20g" -> "밥 420g", "닭가슴살 1 80g" -> "닭가슴살 180g"
    .replace(/(\d)\s+(\d+(?:\.\d+)?)(?=\s*(?:g|그램)\b)/gi, "$1$2")
    // 단위 앞 공백은 정리한다. 예: "200 g" -> "200g"
    .replace(/(\d+(?:\.\d+)?)\s+(g|그램)\b/gi, "$1$2")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function formatMemoItemName(value) {
  return String(value || "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function parseFoodEntries(text, customFoods, options = {}) {
  const entries = [];
  const rowIndex = options.rowIndex ?? 0;
  const basisMap = options.basisMap || {};
  const unitOverrides = options.unitOverrides || {};

  const quantityPattern = "[0-9]+(?:\\.[0-9]+)?|한|하나|두|둘|세|셋|네|넷|다섯|여섯|일곱|여덟|아홉|열|반";
  const unitPattern = "개|알|공기|밥공기|그릇|줌|컵|잔|팩|스쿱|봉|조각";

  const pushGramEntry = (inputName, amount, segmentIndex, entryIndex) => {
    const displayName = String(inputName || "").trim();
    const cleanName = cleanFoodName(displayName);
    const cleanAmount = toNumber(amount);
    if (!cleanName) return false;

    const basisFood = getMemoFoodBasis(basisMap, rowIndex, segmentIndex, entryIndex, cleanName);
    entries.push(createItem(
      cleanName,
      cleanAmount,
      customFoods,
      displayName + (cleanAmount > 0 ? " " + formatAmount(cleanAmount) + "g" : ""),
      undefined,
      basisFood,
      { inputName: displayName }
    ));
    return true;
  };

  const pushUnitEntry = (inputName, quantity, unitText, segmentIndex, entryIndex) => {
    const displayName = String(inputName || "").trim();
    const cleanName = cleanFoodName(displayName);
    const cleanQuantity = toNumber(quantity);
    if (!cleanName || cleanQuantity <= 0 || !unitText) return false;

    const basisFood = getMemoFoodBasis(basisMap, rowIndex, segmentIndex, entryIndex, cleanName);
    const unitInfo = resolveFoodUnitInfo(cleanName, cleanQuantity, unitText, customFoods, basisFood);
    const rawLine = displayName + " " + formatAmount(cleanQuantity) + unitText;

    if (unitInfo) {
      entries.push(createItem(
        cleanName,
        unitInfo.amount,
        customFoods,
        rawLine,
        undefined,
        unitInfo.food || basisFood,
        { displayAmount: cleanQuantity, displayUnit: unitText, inputName: displayName }
      ));
      return true;
    }

    entries.push(createUnsupportedOrOverrideItem(
      displayName,
      cleanQuantity,
      unitText,
      customFoods,
      rawLine,
      basisFood,
      unitOverrides
    ));
    return true;
  };

  splitFoodSegments(text).forEach((segment, segmentIndex) => {
    const source = normalizeMemoFoodSegment(segment);
    if (!source) return;
    let entryIndex = 0;

    // 1) 붙여 쓴 g: 닭가슴살270g, 소고기등심200g
    let match = source.match(/^(.+?)([0-9]+(?:\.[0-9]+)?)(?:g|그램)$/i);
    if (match) {
      if (pushGramEntry(match[1], match[2], segmentIndex, entryIndex)) entryIndex += 1;
      return;
    }

    // 2) 띄어 쓴 g: 소고기 등심 200g / 소고기 등심 200 g / 밥 200
    match = source.match(/^(.+?)\s+([0-9]+(?:\.[0-9]+)?)(?:\s*(?:g|그램))?$/i);
    if (match) {
      if (pushGramEntry(match[1], match[2], segmentIndex, entryIndex)) entryIndex += 1;
      return;
    }

    // 3) 붙여 쓴 수량 단위: 바나나1개 / 계란한개 / 계란0.5개
    match = source.match(new RegExp("^(.+?)(" + quantityPattern + ")(" + unitPattern + ")$"));
    if (match) {
      const quantity = parseKoreanQuantity(match[2]);
      if (pushUnitEntry(match[1], quantity, match[3], segmentIndex, entryIndex)) entryIndex += 1;
      return;
    }

    // 4) 띄어 쓴 수량 단위: 바나나 1개 / 계란 한개 / 계란 한 개 / 소고기 등심 1팩
    match = source.match(new RegExp("^(.+?)\\s+(" + quantityPattern + ")\\s*(" + unitPattern + ")$"));
    if (match) {
      const quantity = parseKoreanQuantity(match[2]);
      if (pushUnitEntry(match[1], quantity, match[3], segmentIndex, entryIndex)) entryIndex += 1;
      return;
    }

    // 5) 음식명만 있는 경우: 제육
    const displayName = source.trim();
    const cleanName = cleanFoodName(displayName);
    if (cleanName) {
      const basisFood = getMemoFoodBasis(basisMap, rowIndex, segmentIndex, entryIndex, cleanName);
      entries.push(createItem(cleanName, 0, customFoods, displayName, undefined, basisFood, { inputName: displayName }));
    }
  });

  return entries;
}

export function parseDailyMemoInput(input, customFoods, basisMap = {}, unitOverrides = {}) {
  const lines = String(input)
    .split("\n")
    .map((line, originalIndex) => ({ line: line.trim(), originalIndex }))
    .filter((entry) => entry.line);

  const meals = [];
  const errors = [];
  const unitTargets = [];

  const makePlaceholderItems = (foodText) => {
    const cleanText = String(foodText || "").trim();
    if (!cleanText) return [];
    return splitFoodSegments(cleanText)
      .map((segment) => cleanFoodName(segment))
      .filter(Boolean)
      .map((name) => createItem(name, 0, customFoods, name, undefined, null, { inputName: name }));
  };

  lines.forEach(({ line, originalIndex }) => {
    const match = line.match(/^(\d{1,2}(?::\d{1,2})?)\s+(.+)$/);

    if (!match) {
      if (meals.length === 0) {
        errors.push(`${originalIndex + 1}번째 줄: 시각을 먼저 입력해 주세요.`);
        return;
      }

      let items = parseFoodEntries(line, customFoods, { basisMap, rowIndex: originalIndex, unitOverrides });
      if (items.length === 0) items = makePlaceholderItems(line);
      const unsupportedUnitItem = getUnsupportedUnitItem(items);
      if (unsupportedUnitItem) {
        unitTargets.push(createUnitWeightTarget(unsupportedUnitItem, originalIndex + 1));
        return;
      }
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

    let items = parseFoodEntries(match[2], customFoods, { basisMap, rowIndex: originalIndex, unitOverrides });
    if (items.length === 0) items = makePlaceholderItems(match[2]);
    const unsupportedUnitItem = getUnsupportedUnitItem(items);
    if (unsupportedUnitItem) {
      unitTargets.push(createUnitWeightTarget(unsupportedUnitItem, originalIndex + 1));
      return;
    }
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

  return { meals, errors, unitTargets };
}

export function mergeMealsWithSameTime(meals) {
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

export function formatTimeDraft(value) {
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

export function parseTimeInput(value) {
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

export function sortMealsLatestFirst(meals) {
  return [...meals].sort((a, b) => b.time.localeCompare(a.time));
}
