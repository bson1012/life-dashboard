// 실적(월 사용 금액 구간)과 청구·할인 계산.
// 거래의 amount 는 승인 금액입니다. 실적은 승인 금액 기준으로 셉니다.
// 거래의 billed 는 청구 금액(할인 후)입니다. 없으면 승인 금액과 같습니다.
// 할인액 = 승인 금액 - 청구 금액. 결제수단의 discountLimit(월 할인 한도, 원)과 비교합니다.
// 실적 tiers 는 만원 단위이고, 거래 금액은 원 단위입니다.
// 거래의 counts 가 false 이면 실적에서 뺍니다. counts 가 없으면 신용·체크카드는 포함, 나머지는 제외합니다.
// 취소(type: 'cancel')는 취소한 달의 실적·청구·할인에서 뺍니다.


import { billedOf, netExpenseOf } from './ledger';

export const TIER_UNIT = 10000;

export const perfOf = (p) =>
  !!p && (p.perf ?? (p.tiers?.length ?? 0) > 0);

export function isCounted(tx, pay) {
  return perfOf(pay) && (tx.counts ?? true);
}

export function performanceFor(rows, payments, month) {
  const paymentById = Object.fromEntries(payments.map((p) => [p.id, p]));
  const rowById = Object.fromEntries(rows.map((r) => [r.id, r]));
  const agg = {};

  const getAgg = (paymentId) =>
    (agg[paymentId] ??= { spent: 0, billed: 0, discount: 0 });

  // 1. 원결제 월 기준: 청구액과 할인액은 취소가 반영된 순액으로 계산
  // 실적 사용액은 일단 원결제 월에 승인된 금액을 더합니다.
  for (const r of rows) {
    if (r.type !== 'expense' || !r.date.startsWith(month)) continue;

    const p = paymentById[r.paymentId];
    if (!p) continue;

    const a = getAgg(p.id);
    const net = netExpenseOf(rows, r);

    a.billed += billedOf(net);
    a.discount += net.amount - billedOf(net);

    if (isCounted(r, p)) {
      a.spent += r.amount;
    }
  }

  // 2. 취소 발생 월 기준: 해당 월의 카드 실적에서 취소 승인액만 차감
  // 원거래의 실적 포함 여부를 기준으로 판단합니다.
  for (const r of rows) {
    if (r.type !== 'cancel' || !r.date.startsWith(month)) continue;

    const orig = rowById[r.refId];
    if (!orig) continue;

    const p = paymentById[orig.paymentId];
    if (!p || !isCounted(orig, p)) continue;

    const a = getAgg(p.id);
    a.spent -= r.amount;
  }

  return payments
    .filter(
      (p) =>
        perfOf(p) &&
        (agg[p.id] || (p.tiers?.length ?? 0) > 0 || p.discountLimit > 0),
    )
    .map((p) => {
      const a = agg[p.id] ?? { spent: 0, billed: 0, discount: 0 };
      const spent = a.spent;
      const tiers = [...(p.tiers ?? [])]
        .sort((x, y) => x - y)
        .map((t) => t * TIER_UNIT);

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
