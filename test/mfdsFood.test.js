import test from "node:test";
import assert from "node:assert/strict";
import { groupMfdsFoods, searchMfdsFoods } from "../server/mfdsFood.js";

const duplicateRows = [
  {
    FOOD_CD: "A1",
    FOOD_NM_KR: "안심돈까스",
    FOOD_CAT1_NM: "조리식품",
    NUTRI_AMOUNT_SERVING: "100g",
    AMT_NUM1: "220",
    AMT_NUM3: "14",
    AMT_NUM4: "12",
    AMT_NUM6: "20",
  },
  {
    FOOD_CD: "A2",
    FOOD_NM_KR: "안심 돈까스",
    FOOD_CAT1_NM: "조리식품",
    NUTRI_AMOUNT_SERVING: "100",
    AMT_NUM1: "260",
    AMT_NUM3: "16",
    AMT_NUM4: "14",
    AMT_NUM6: "22",
  },
  {
    FOOD_CD: "A3",
    FOOD_NM_KR: "안심돈까스",
    FOOD_CAT1_NM: "조리식품",
    NUTRI_AMOUNT_SERVING: "100",
    AMT_NUM1: "300",
    AMT_NUM3: "18",
    AMT_NUM4: "16",
    AMT_NUM6: "24",
  },
];

test("동일 음식명은 하나의 중앙값 대표 결과로 묶는다", () => {
  const results = groupMfdsFoods(duplicateRows, "안심돈까스");
  assert.equal(results.length, 1);
  assert.equal(results[0].sampleCount, 3);
  assert.equal(results[0].kcal, 260);
  assert.equal(results[0].protein, 16);
  assert.equal(results[0].kcalMin, 220);
  assert.equal(results[0].kcalMax, 300);
});

test("식약처 응답을 검색 결과 배열로 변환한다", async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      response: {
        header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
        body: { items: { item: duplicateRows } },
      },
    }),
  });

  const results = await searchMfdsFoods({
    query: "안심돈까스",
    apiKey: "test-key",
    fetchImpl,
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].source, "mfds_api");
});
