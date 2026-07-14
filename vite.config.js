import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { searchMfdsFoods } from "./server/mfdsFood.js";

function mfdsDevApiPlugin(env) {
  return {
    name: "mfds-dev-api",
    configureServer(server) {
      server.middlewares.use("/api/mfds-food-search", async (request, response) => {
        if (request.method !== "GET") {
          response.statusCode = 405;
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.end(JSON.stringify({ error: "GET 요청만 사용할 수 있어." }));
          return;
        }

        const url = new URL(request.url || "", "http://localhost");
        const query = String(url.searchParams.get("q") || "").trim();
        const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 20, 1), 50);

        response.setHeader("Content-Type", "application/json; charset=utf-8");
        if (!query) {
          response.end(JSON.stringify({ results: [] }));
          return;
        }

        try {
          const results = await searchMfdsFoods({
            query,
            limit,
            apiKey: env.MFDS_API_KEY || env.GOV_API_KEY,
          });
          response.end(JSON.stringify({ results }));
        } catch (error) {
          response.statusCode = 500;
          response.end(JSON.stringify({ error: error?.message || "식약처 음식 검색에 실패했어." }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [react(), mfdsDevApiPlugin(env)],
  };
});
