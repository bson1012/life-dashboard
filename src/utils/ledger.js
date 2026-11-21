
import { EXPENSE_TREE, INCOME_TREE, treeNames } from '../config/ledgerCategories';

// 대분류 이름 목록 (기존 코드 호환용)
export const EXPENSE_CATEGORIES = treeNames(EXPENSE_TREE);
export const INCOME_CATEGORIES = treeNames(INCOME_TREE);

// 거래 금액 용어
export const cardDiscountOf = (r) =>
  r.cardDiscount ?? (r.billed !== undefined ? r.amount - r.billed : 0);
export const supportOf = (r) => r.support ?? 0;
export const isDeductible = (r) => r.deductible ?? true;
export const billedOf = (r) => r.amount - cardDiscountOf(r);
export const actualOf = (r) => r.amount - cardDiscountOf(r) - supportOf(r);

export function discountWon(amount, mode, value) {
  const v = Number(value) || 0;
  const won = mode === 'rate' ? Math.round((amount * v) / 100) : v;
  return Math.min(Math.max(won, 0), amount);
}

// 원래 지출에 연결된 취소 합계
const linkedCancelsOf = (rows, id) =>
  rows.filter((r) => r.type === 'cancel' && r.refId === id);

export const cancelledOf = (rows, id) =>
  linkedCancelsOf(rows, id).reduce((sum, r) => sum + r.amount, 0);

export const cancelledDiscountOf = (rows, id) =>
  linkedCancelsOf(rows, id).reduce((sum, r) => sum + cardDiscountOf(r), 0);

export const cancelledSupportOf = (rows, id) =>
  linkedCancelsOf(rows, id).reduce((sum, r) => sum + supportOf(r), 0);

// 취소가 반영된 원거래 금액
export function netExpenseOf(rows, orig) {
  return {
    ...orig,
    amount: Math.max(orig.amount - cancelledOf(rows, orig.id), 0),
    cardDiscount: Math.max(
      cardDiscountOf(orig) - cancelledDiscountOf(rows, orig.id),
      0,
    ),
    support: Math.max(
      supportOf(orig) - cancelledSupportOf(rows, orig.id),
      0,
    ),
  };
}

// 원래 지출에서 아직 취소되지 않은 승인 금액
export const remainingOf = (rows, orig) =>
  Math.max(orig.amount - cancelledOf(rows, orig.id), 0);

// 월별 가계부 요약
// 취소는 취소 발생 월이 아니라 원결제 월의 원거래에 반영합니다.
// list에는 취소 내역도 남겨 두어 취소 발생일 기준으로 확인할 수 있습니다.
export function summarize(rows, month) {
  const list = rows.filter((r) => r.date.startsWith(month));
  let income = 0;
  let expense = 0;
  let billed = 0;
  let approved = 0;
  let deductible = 0;
  let personal = 0;
  const byCategory = {};

  for (const r of list) {
    if (r.type === 'income') {
      income += r.amount;
      continue;
    }

    // 취소 레코드는 별도로 지출 합계에 넣지 않습니다.
    // 원거래를 계산할 때 연결된 모든 취소가 이미 반영됩니다.
    if (r.type !== 'expense') continue;

    const net = netExpenseOf(rows, r);
    const act = actualOf(net);

    expense += act;
    billed += billedOf(net);
    approved += net.amount;
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
