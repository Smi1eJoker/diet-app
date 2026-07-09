export async function searchPublicFoods(query) {
  const keyword = String(query || "").trim();
  if (!keyword) return [];

  const response = await fetch(`/api/public-food-search?q=${encodeURIComponent(keyword)}`);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data?.detail || data?.error || "공공데이터 음식 검색 실패");
  }

  return Array.isArray(data.foods) ? data.foods : [];
}
