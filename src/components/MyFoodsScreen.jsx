import { useState } from "react";
import useLongPress from "../hooks/useLongPress";
import { cleanFoodName, getAliasTargetTypeLabel, getFoodDisplayName } from "../utils/foodMatch";
import { formatAmount, formatMacro, toNumber } from "../utils/nutrition";

export function InlineActionSheet({ title, editLabel = "수정하기", deleteLabel = "삭제하기", onEdit, onDelete, onClose }) {
  return (
    <div className="sheet-backdrop" role="presentation" onClick={onClose}>
      <div className="action-sheet" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        {title && <strong className="action-sheet-title">{title}</strong>}
        {onEdit && <button type="button" onClick={onEdit}>{editLabel}</button>}
        {onDelete && <button type="button" className="danger-button" onClick={onDelete}>{deleteLabel}</button>}
        <button type="button" className="ghost-button" onClick={onClose}>취소</button>
      </div>
    </div>
  );
}

export function ManagedFoodCard({ food, onEdit, onDelete }) {
  const [isActionOpen, setIsActionOpen] = useState(false);
  const foodName = getFoodDisplayName(food);
  const longPressProps = useLongPress(() => setIsActionOpen(true));

  return (
    <>
      <article
        className="my-food-card my-food-longpress-card"
        aria-label={foodName + " 직접 등록 음식"}
        title="길게 눌러 수정/삭제"
        {...longPressProps}
      >
        <div className="my-food-main">
          <strong>{foodName}</strong>
          <span>100g {Math.round(food.kcal)}kcal</span>
        </div>
        <div className="my-food-macros">
          C {formatMacro(food.carb)}g · P {formatMacro(food.protein)}g · F {formatMacro(food.fat)}g
        </div>
      </article>

      {isActionOpen && (
        <InlineActionSheet
          title={foodName}
          editLabel="음식 수정"
          deleteLabel="음식 삭제"
          onEdit={() => {
            setIsActionOpen(false);
            onEdit(food);
          }}
          onDelete={() => {
            setIsActionOpen(false);
            onDelete(food);
          }}
          onClose={() => setIsActionOpen(false)}
        />
      )}
    </>
  );
}

export function AliasConnectionCard({ alias, onDeleteAlias }) {
  const [isActionOpen, setIsActionOpen] = useState(false);
  const aliasName = cleanFoodName(alias.aliasText || alias.name || "");
  const targetName = cleanFoodName(alias.canonicalName || getFoodDisplayName(alias));
  const typeLabel = getAliasTargetTypeLabel(alias);
  const longPressProps = useLongPress(() => setIsActionOpen(true));

  return (
    <>
      <article
        className="my-food-card my-alias-card my-food-longpress-card"
        aria-label={aliasName + " 음식 연결"}
        title="길게 눌러 수정/삭제"
        {...longPressProps}
      >
        <div className="my-alias-line">
          <strong>{aliasName}</strong>
          <span aria-hidden="true">-</span>
          <em>{targetName}<small>({typeLabel})</small></em>
        </div>
      </article>

      {isActionOpen && (
        <InlineActionSheet
          title={aliasName + " - " + targetName}
          deleteLabel="연결 삭제"
          onDelete={() => {
            setIsActionOpen(false);
            onDeleteAlias(alias);
          }}
          onClose={() => setIsActionOpen(false)}
        />
      )}
    </>
  );
}

export function UnitSettingCard({ unit, onEdit, onDelete }) {
  const [isActionOpen, setIsActionOpen] = useState(false);
  const unitText = cleanFoodName(unit.unitName || "");
  const foodName = cleanFoodName(unit.foodName || getFoodDisplayName(unit.targetFood));
  const lineText = foodName + " 1" + unitText + " = " + formatAmount(toNumber(unit.grams)) + "g";
  const longPressProps = useLongPress(() => setIsActionOpen(true));

  return (
    <>
      <article
        className="my-food-card my-unit-card my-food-longpress-card"
        aria-label={lineText}
        title="길게 눌러 수정/삭제"
        {...longPressProps}
      >
        <div className="my-unit-line">{lineText}</div>
      </article>

      {isActionOpen && (
        <InlineActionSheet
          title={lineText}
          editLabel="단위 수정"
          deleteLabel="단위 삭제"
          onEdit={() => {
            setIsActionOpen(false);
            onEdit(unit);
          }}
          onDelete={() => {
            setIsActionOpen(false);
            onDelete(unit);
          }}
          onClose={() => setIsActionOpen(false)}
        />
      )}
    </>
  );
}

export default function MyFoodsScreen({ foods, aliases = [], units = [], onAdd, onEdit, onDelete, onDeleteAlias, onEditUnit, onDeleteUnit }) {
  const [activeMyFoodTab, setActiveMyFoodTab] = useState("foods");

  const tabCopy = {
    foods: {
      kicker: "개인 음식 DB",
      title: "직접 등록",
      description: "직접 등록한 음식은 다음 메모 입력부터 자동 계산돼.",
    },
    aliases: {
      kicker: "개인 연결 규칙",
      title: "음식 연결",
      description: "내가 입력하는 이름과 실제 계산 음식을 관리해.",
    },
    units: {
      kicker: "개인 단위 설정",
      title: "단위 설정",
      description: "개/인분/공기 같은 단위별 g 설정을 관리해.",
    },
  }[activeMyFoodTab];

  return (
    <section className="my-foods-screen" aria-label="나의 음식">
      <div className="my-foods-head">
        <div>
          <span>{tabCopy.kicker}</span>
          <strong>나의 음식</strong>
          <p>{tabCopy.description}</p>
        </div>
        {activeMyFoodTab === "foods" && (
          <button type="button" className="primary-button" onClick={onAdd}>추가</button>
        )}
      </div>

      <div className="segmented-control my-food-tabs" role="tablist" aria-label="나의 음식 관리 탭">
        <button
          type="button"
          className={activeMyFoodTab === "foods" ? "is-selected" : ""}
          onClick={() => setActiveMyFoodTab("foods")}
        >
          직접 등록
        </button>
        <button
          type="button"
          className={activeMyFoodTab === "aliases" ? "is-selected" : ""}
          onClick={() => setActiveMyFoodTab("aliases")}
        >
          음식 연결
        </button>
        <button
          type="button"
          className={activeMyFoodTab === "units" ? "is-selected" : ""}
          onClick={() => setActiveMyFoodTab("units")}
        >
          단위 설정
        </button>
      </div>

      {activeMyFoodTab === "foods" && (
        foods.length === 0 ? (
          <div className="empty-state">
            <strong>아직 저장한 음식이 없어.</strong>
            <span>식단 카드의 음식 연결/등록에서 추가하거나 여기서 직접 추가해.</span>
          </div>
        ) : (
          <div className="my-food-list">
            {foods.map((food) => (
              <ManagedFoodCard
                key={food.userFoodId || food.id || food.name}
                food={food}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            ))}
          </div>
        )
      )}

      {activeMyFoodTab === "aliases" && (
        aliases.length === 0 ? (
          <div className="empty-state">
            <strong>아직 저장한 음식 연결이 없어.</strong>
            <span>후보창에서 앞으로도 사용을 누르면 여기에 표시돼.</span>
          </div>
        ) : (
          <div className="my-food-list">
            {aliases.map((alias) => (
              <AliasConnectionCard
                key={alias.aliasId || alias.id || cleanFoodName(alias.aliasText || alias.name || "")}
                alias={alias}
                onDeleteAlias={onDeleteAlias}
              />
            ))}
          </div>
        )
      )}

      {activeMyFoodTab === "units" && (
        units.length === 0 ? (
          <div className="empty-state">
            <strong>아직 저장한 단위 설정이 없어.</strong>
            <span>예: 바나나 1개 입력 후 g을 등록하면 여기에 표시돼.</span>
          </div>
        ) : (
          <div className="my-food-list">
            {units.map((unit) => (
              <UnitSettingCard
                key={unit.userUnitId || unit.unitId || unit.foodName + unit.unitName}
                unit={unit}
                onEdit={onEditUnit}
                onDelete={onDeleteUnit}
              />
            ))}
          </div>
        )
      )}
    </section>
  );
}
