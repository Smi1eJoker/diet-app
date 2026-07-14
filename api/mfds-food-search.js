import { searchMfdsFoods } from "../server/mfdsFood.js";

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: "GET 요청만 사용할 수 있어." });
  }

  const query = String(request.query?.q || "").trim();
  const limit = Math.min(Math.max(Number(request.query?.limit) || 20, 1), 50);

  if (!query) return response.status(200).json({ results: [] });

  try {
    const results = await searchMfdsFoods({
      query,
      limit,
      apiKey: process.env.MFDS_API_KEY || process.env.GOV_API_KEY,
    });

    response.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
    return response.status(200).json({ results });
  } catch (error) {
    return response.status(500).json({ error: error?.message || "식약처 음식 검색에 실패했어." });
  }
}
