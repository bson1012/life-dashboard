// 실적(월 사용 금액 구간)과 청구·할인 계산.
// 실적과 청구는 따로 계산합니다.
// - 실적: 거래의 amount(승인 금액)를 사용한 달(달력 월)에 셉니다. 취소는 취소한 달에 뺍니다.
//   단, 취소에 perfOff 가 켜져 있으면 실적에서 빼지 않습니다.
// - 청구: 카드사별 이용기간·결제일로 정한 청구월(billing.js)에 셉니다. 취소는 거래마다 정한 청구월에 뺍니다.
// 실적 tiers 는 만원 단위이고, 거래 금액은 원 단위입니다.
// 거래의 counts 가 false 이면 실적에서 뺍니다. counts 가 없으면 신용·체크카드는 포함, 나머지는 제외합니다.

import { billingFor } from './billing';

export const TIER_UNIT = 10000;

export const perfOf = (p) =>
  !!p && (p.perf ?? (p.tiers?.length ?? 0) > 0);

export function isCounted(tx, pay) {
  return perfOf(pay) && (tx.counts ?? true);
}

export function performanceFor(rows, payments, issuers, month) {
  const paymentById = Object.fromEntries(payments.map((p) => [p.id, p]));
  const rowById = Object.fromEntries(rows.map((r) => [r.id, r]));
  const spentBy = {};

  // 1. 실적: 사용한 달 기준 승인액
  for (const r of rows) {
    if (r.type !== 'expense' || !r.date.startsWith(month)) continue;
    const p = paymentById[r.paymentId];
    if (p && isCounted(r, p)) spentBy[p.id] = (spentBy[p.id] ?? 0) + r.amount;
  }

  // 2. 실적 취소: 취소한 달에 취소 승인액을 뺍니다 (perfOff 면 빼지 않음)
  for (const r of rows) {
    if (r.type !== 'cancel' || !r.date.startsWith(month) || r.perfOff) continue;
    const orig = rowById[r.refId];
    const p = orig && paymentById[orig.paymentId];
    if (!p || !isCounted(orig, p)) continue;
    spentBy[p.id] = (spentBy[p.id] ?? 0) - r.amount;
  }

  // 3. 청구: 청구월 기준 (카드사별 일정 반영)
  const { byPayment } = billingFor(rows, payments, issuers, month);

  return payments
    .filter(
      (p) =>
        perfOf(p) &&
        (spentBy[p.id] !== undefined || byPayment[p.id] || (p.tiers?.length ?? 0) > 0 || p.discountLimit > 0),
    )
    .map((p) => {
      const spent = spentBy[p.id] ?? 0;
      const billed = byPayment[p.id]?.billed ?? 0;
      const discount = byPayment[p.id]?.discount ?? 0;
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
        billed,
        discount,
        discountLimit: limit,
        discountRemaining: limit ? limit - discount : null,
      };
    });
}
