# Diet App

React/Vite + Supabase 기반 식단·운동 기록 앱입니다.

## 이번 음식 DB 구조

- 메모장 입력 중에는 식약처 API를 호출하지 않습니다.
- 메모 입력은 `user_aliases → user_foods → 활성 app_foods` 순서로만 연결합니다.
- 기준 엑셀의 원재료성·기본 음식 131개만 `app_foods.is_active = true`로 노출합니다.
- DB에 없는 음식은 **음식 연결/등록** 또는 **나의 음식 추가** 창에서만 식약처 API로 검색합니다.
- 식약처에서 같은 음식명이 여러 번 반환되면 서버에서 하나로 묶고 영양성분 중앙값을 대표값으로 제공합니다.
- 선택한 결과는 `user_foods`에 저장되어 다음부터 API 호출 없이 사용됩니다.

## 1. 환경변수

`.env.example`을 참고해 로컬 `.env.local`과 Vercel 환경변수를 설정합니다.

```env
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
MFDS_API_KEY=...
```

`MFDS_API_KEY`에는 공공데이터포털에서 발급받은 식약처 OpenAPI 일반 인증키를 넣습니다. 이 값에는 `VITE_` 접두사를 붙이지 마세요.

## 2. Supabase 마이그레이션

Supabase SQL Editor에서 다음 파일을 실행합니다.

```text
supabase/20260714_keep_base_foods.sql
```

기존 음식을 삭제하지 않고 `is_active`로 숨기므로 되돌릴 수 있습니다. 실행 후 마지막 확인 쿼리에서 활성 음식 수와 목록을 점검하세요.

## 3. 실행

```bash
npm install
npm run dev
```

Vite 개발 서버에서도 `/api/mfds-food-search`가 동작하도록 로컬 미들웨어가 포함되어 있습니다.

## 4. 배포

Vercel 프로젝트 환경변수에 `MFDS_API_KEY`를 추가한 후 다시 배포합니다. `/api/mfds-food-search.js`가 서버 함수로 실행되어 인증키를 브라우저에 노출하지 않습니다.

## 검증

```bash
npm test
npm run lint:mfds
npm run build
```
