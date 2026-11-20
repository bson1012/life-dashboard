import { EXPENSE_TREE, INCOME_TREE, treeNames } from '../config/ledgerCategories';

// 대분류 이름 목록 (기존 코드 호환용)
export const EXPENSE_CATEGORIES = treeNames(EXPENSE_TREE);
export const INCOME_CATEGORIES = treeNames(INCOME_TREE);

// 거래 금액 용어
// amount        : 승인 금액 (카드사에 승인된 금액, 실적 기준)
// cardDiscount  : 카드사 할인 (청구 금액을 줄이는 금액)
// support       : 지원 금액 (N빵, 회사 지원 등 나중에 돌려받는 금액)
// billed        : 청구 금액 = 승인 - 카드사 할인
// actual        : 실제 사용 금액 = 승인 - 카드사 할인 - 지원
// 예전 거래는 cardDiscount 가 없고 billed 만 있을 수 있어서 billed 에서 할인을 계산합니다.
export const cardDiscountOf = (r) => r.cardDiscount ?? (r.billed !== undefined ? r.amount - r.billed : 0);
export const supportOf = (r) => r.support ?? 0;
// 공제 포함은 기본값이 켜짐입니다. 예전 거래에 값이 없어도 공제로 봅니다.
export const isDeductible = (r) => r.deductible ?? true;
export const billedOf = (r) => r.amount - cardDiscountOf(r);
export const actualOf = (r) => r.amount - cardDiscountOf(r) - supportOf(r);

// 카드사 할인 금액(원). mode 가 'rate' 면 승인 금액의 % , 'won' 이면 정해진 원 금액입니다.
// 할인은 승인 금액을 넘을 수 없습니다.
export function discountWon(amount, mode, value) {
  const v = Number(value) || 0;
  const won = mode === 'rate' ? Math.round((amount * v) / 100) : v;
  return Math.min(Math.max(won, 0), amount);
}

// 거래 종류: income(수입) / expense(지출) / cancel(지출 취소, refId 가 원래 지출을 가리킴)
// 취소는 취소한 달의 지출에서 뺍니다.
export function summarize(rows, month) {
  const list = rows.filter((r) => r.date.startsWith(month));
  let income = 0;
  let expense = 0; // 실제 사용 금액 합계
  let billed = 0; // 카드 청구 금액 합계
  let approved = 0; // 승인 금액 합계
  let deductible = 0; // 공제 포함 실제 사용 금액
  let personal = 0; // 개인 사용 실제 사용 금액
  const byCategory = {};

  for (const r of list) {
    if (r.type === 'income') {
      income += r.amount;
      continue;
    }
    if (r.type !== 'expense' && r.type !== 'cancel') continue;
    const s = r.type === 'cancel' ? -1 : 1;
    const act = s * actualOf(r);
    expense += act;
    billed += s * billedOf(r);
    approved += s * r.amount;
    byCategory[r.category] = (byCategory[r.category] || 0) + act;
    if (isDeductible(r)) deductible += act;
    if (r.personal) personal += act;
  }

  const categories = Object.entries(byCategory)
    .filter(([, amt]) => amt > 0)
    .sort((a, b) => b[1] - a[1]);
  return {
    income,
    expense,
    billed,
    approved,
    balance: income - expense,
    deductible,
    personal,
    categories,
    list,
  };
}

// 원래 지출 하나에 연결된 취소 금액(승인 기준) 합계
export const cancelledOf = (rows, id) =>
  rows.reduce((sum, r) => (r.type === 'cancel' && r.refId === id ? sum + r.amount : sum), 0);

// 원래 지출에서 아직 취소되지 않은 승인 금액
export const remainingOf = (rows, orig) => orig.amount - cancelledOf(rows, orig.id);
