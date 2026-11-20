// 실적(월 사용 금액 구간)과 청구·할인 계산.
// 거래의 amount 는 승인 금액입니다. 실적은 승인 금액 기준으로 셉니다.
// 거래의 billed 는 청구 금액(할인 후)입니다. 없으면 승인 금액과 같습니다.
// 할인액 = 승인 금액 - 청구 금액. 결제수단의 discountLimit(월 할인 한도, 원)과 비교합니다.
// 실적 tiers 는 만원 단위이고, 거래 금액은 원 단위입니다.
// 거래의 counts 가 false 이면 실적에서 뺍니다. counts 가 없으면 신용·체크카드는 포함, 나머지는 제외합니다.
// 취소(type: 'cancel')는 취소한 달의 실적·청구·할인에서 뺍니다.

import { billedOf, cardDiscountOf } from './ledger';

export const TIER_UNIT = 10000;

// 결제수단의 실적 관리 여부. perf 를 명시하지 않은 예전 결제수단은 실적 구간(tiers)이 있으면 관리합니다.
export const perfOf = (p) => !!p && (p.perf ?? (p.tiers?.length ?? 0) > 0);

// 실적 관리 결제수단의 거래 중 counts 가 false 가 아닌 것만 실적에 셉니다.
export function isCounted(tx, pay) {
  return perfOf(pay) && (tx.counts ?? true);
}


// 한 달 동안 결제수단별 실적 사용액, 청구액, 할인 사용액과 남은 할인 한도를 계산합니다.
export function performanceFor(rows, payments, month) {
  const paymentById = Object.fromEntries(payments.map((p) => [p.id, p]));
  const agg = {};

  for (const r of rows) {
    if ((r.type !== 'expense' && r.type !== 'cancel') || !r.date.startsWith(month)) continue;
    const p = paymentById[r.paymentId];
    if (!p) continue;
    const sign = r.type === 'cancel' ? -1 : 1;
    const a = (agg[p.id] ??= { spent: 0, billed: 0, discount: 0 });
    a.billed += sign * billedOf(r);
    a.discount += sign * cardDiscountOf(r);
    if (isCounted(r, p)) a.spent += sign * r.amount;
  }

  return payments
    .filter((p) => perfOf(p) && (agg[p.id] || (p.tiers?.length ?? 0) > 0 || p.discountLimit > 0))
    .map((p) => {
      const a = agg[p.id] ?? { spent: 0, billed: 0, discount: 0 };
      const spent = a.spent;
      const tiers = [...(p.tiers ?? [])].sort((x, y) => x - y).map((t) => t * TIER_UNIT);
      const achieved = tiers.filter((t) => spent >= t).pop() ?? 0;
      const next = tiers.find((t) => t > spent) ?? null;
      const target = next ?? tiers[tiers.length - 1] ?? null;
      const limit = p.discountLimit ?? 0;
      return {
        payment: p,
        spent,
        achieved,
        next,
        remaining: next ? next - spent : 0,
        ratio: target ? Math.min(1, spent / target) : null,
        billed: a.billed,
        discount: a.discount,
        discountLimit: limit,
        discountRemaining: limit ? limit - a.discount : null,
      };
    });
}
