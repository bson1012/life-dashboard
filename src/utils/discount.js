import { cardDiscountOf, netExpenseOf } from './ledger';

// 혜택 할인 계산: 승인 금액 × 혜택 할인율을 구하고, 이번 달 남은 한도를 넘지 않게 자릅니다.
// rows: 전체 거래, month: 'YYYY-MM', paymentId: 카드, limit: 이번 달 한도(원, 없으면 0),
// benefit: 고른 혜택 항목({ rate }), amount: 승인 금액, excludeId: 수정 중인 거래 id(자기 자신은 빼고 셉니다)
// 이번 달 이 카드에서 이미 쓴 할인은 지출의 할인에서 더하고, 취소로 돌려받은 할인은 뺍니다.
// 이번 달 이 카드에서 이미 쓴 혜택 할인(취소 제외 후). 직접 입력한 %/원 할인은 세지 않습니다.
// excludeId 거래는 세지 않습니다. benefitKey 를 주면 그 혜택 분야의 할인만 셉니다.
export function usedLimit({ rows, month, paymentId, excludeId, benefitKey }) {
  return rows.reduce((sum, r) => {
    if (
      r.type !== 'expense' ||
      r.id === excludeId ||
      r.paymentId !== paymentId ||
      !r.date.startsWith(month)
    ) {
      return sum;
    }

    if (!r.benefit) return sum;
    if (benefitKey && r.benefit !== benefitKey) return sum;

    return sum + cardDiscountOf(netExpenseOf(rows, r));
  }, 0);
}

// 이번 달 남은 통합 한도. 한도가 정해지지 않았으면 0.
export function remainingLimit({ rows, month, paymentId, limit, excludeId }) {
  if (!limit) return 0;
  return Math.max(limit - usedLimit({ rows, month, paymentId, excludeId }), 0);
}

// 분야별 남은 한도. cap(분야별 한도)이 없는 카드는 null.
export function benefitLeft({ rows, month, paymentId, cap, benefit, excludeId }) {
  if (!cap || !benefit) return null;
  return Math.max(cap - usedLimit({ rows, month, paymentId, excludeId, benefitKey: benefit.key }), 0);
}

// 혜택 할인 = 승인 금액 × 할인율, 통합 남은 한도와 분야별 남은 한도(있으면)를 넘지 않게 자릅니다.
export function benefitDiscount({ rows, month, paymentId, limit, cap = null, benefit, amount, excludeId }) {
  if (!benefit || !limit || !(amount > 0)) return 0;
  const remaining = remainingLimit({ rows, month, paymentId, limit, excludeId });
  const left = benefitLeft({ rows, month, paymentId, cap, benefit, excludeId });
  // % 혜택은 승인 금액 × 할인율, 원 혜택은 거래마다 정해진 금액(승인 금액을 넘지 않게)
  const raw = benefit.unit === 'won' ? Math.round(benefit.rate) : Math.round((amount * benefit.rate) / 100);
  return Math.min(raw, remaining, left ?? Infinity, amount);
}

// 이번 달 카드별 한도 한 줄 찾기
export const recordFor = (limitRows, paymentId, month) =>
  limitRows.find((l) => l.paymentId === paymentId && l.month === month) ?? null;

export const limitFor = (limitRows, paymentId, month) =>
  recordFor(limitRows, paymentId, month)?.limit ?? 0;
