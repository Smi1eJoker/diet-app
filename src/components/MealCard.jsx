import useLongPress from "../hooks/useLongPress";
import { normalize } from "../utils/foodMatch";
import { calculateTotals, formatAmount, formatMacro, toNumber } from "../utils/nutrition";

export default function MealCard({ meal, onToggle, onEditMeal, onLongPress, onFoodLongPress, onOpenAmount, onOpenNutrition }) {
  const longPressProps = useLongPress(onLongPress);
  const mealTotals = calculateTotals([meal]);

  return (
    <article className="meal-card">
      <header className="meal-header meal-header-clickable" {...longPressProps} onClick={onEditMeal}>
        <div className="meal-header-main">
          <strong className="meal-time">{meal.time}</strong>
          <div className="meal-summary-inline">
            <span className="meal-summary-kcal">{Math.round(mealTotals.kcal)} kcal</span>
            <span className="meal-summary-macros">
              C {formatMacro(mealTotals.carb)}g P {formatMacro(mealTotals.protein)}g F {formatMacro(mealTotals.fat)}g
            </span>
          </div>
        </div>
        <button
          type="button"
          className="collapse-button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onToggle();
          }}
          aria-label="식단 펼치기 접기"
        >
          {meal.isOpen ? "접기" : "펼치기"}
        </button>
      </header>

      {meal.isOpen && (
        <div className="food-list">
          {meal.items.map((item) => (
            <FoodRow
              key={item.id}
              mealId={meal.id}
              item={item}
              onLongPress={() => onFoodLongPress(item.id)}
              onOpenAmount={onOpenAmount}
              onOpenNutrition={onOpenNutrition}
            />
          ))}
        </div>
      )}
    </article>
  );
}

export function FoodRow({ mealId, item, onLongPress, onOpenAmount, onOpenNutrition }) {
  const longPressProps = useLongPress(onLongPress);
  const needsAmount = item.amount <= 0;
  const needsNutrition = !item.per100;
  const needsRegistration = needsAmount || needsNutrition;
  const matchedFoodName = item.matchedFoodName || "";
  const showMatchedBasis = matchedFoodName && normalize(matchedFoodName) !== normalize(item.name);
  const registrationTitle = needsNutrition && needsAmount ? "중량·영양성분 미등록" : needsNutrition ? "영양성분 미등록" : "중량 미등록";
  const registrationCopy = needsNutrition
    ? "기존 DB에 연결하거나 직접 등록하면 다음부터 자동 계산돼."
    : "섭취 중량만 입력하면 바로 계산돼.";

  const stopNestedTap = (event) => {
    event.stopPropagation();
  };

  return (
    <div
      className="food-row food-row-clickable"
      {...longPressProps}
      onClick={() => onOpenNutrition(mealId, item)}
      title="기준 음식 연결/수정"
    >
      <div className="food-main">
        <strong>
          {item.inputName || item.name}
          {showMatchedBasis && <span className="food-basis-inline">({matchedFoodName})</span>}
        </strong>
        {item.amount > 0 && (
          <span>
            {item.displayUnit && toNumber(item.displayAmount) > 0
              ? formatAmount(toNumber(item.displayAmount)) + item.displayUnit
              : formatAmount(item.amount) + "g"}
          </span>
        )}
      </div>

      <div className="food-detail">
        {item.nutrients ? (
          <span>
            {Math.round(item.nutrients.kcal)}kcal Carb {formatMacro(item.nutrients.carb)}g Pro {formatMacro(item.nutrients.protein)}g Fat {formatMacro(item.nutrients.fat)}g
          </span>
        ) : item.per100 ? (
          <span>
            100g {Math.round(item.per100.kcal)}kcal Carb {formatMacro(item.per100.carb)}g Pro {formatMacro(item.per100.protein)}g Fat {formatMacro(item.per100.fat)}g
          </span>
        ) : needsAmount ? (
          <span>중량과 영양성분을 등록하면 자동 계산돼.</span>
        ) : (
          <span>영양성분을 등록하면 자동 계산돼.</span>
        )}
      </div>

      {needsRegistration && (
        <div className="food-register-actions" aria-label={registrationTitle}>
          {needsNutrition && (
            <button
              type="button"
              onPointerDown={stopNestedTap}
              onClick={(event) => {
                event.stopPropagation();
                onOpenNutrition(mealId, item);
              }}
              title={registrationCopy}
            >
              음식 연결/등록
            </button>
          )}
          {needsAmount && (
            <button
              type="button"
              onPointerDown={stopNestedTap}
              onClick={(event) => {
                event.stopPropagation();
                onOpenAmount(mealId, item);
              }}
              title={registrationCopy}
            >
              중량 등록
            </button>
          )}
        </div>
      )}
    </div>
  );
}
