// 청구 계산: 카드사별 이용기간·결제일로 거래가 어느 청구월에 속하는지 정합니다.
// - 카드사(cardIssuers)는 저장소에 두고 언제든 바꿀 수 있습니다. 여기서는 계산만 합니다.
// - cycle.from / cycle.to: { offset, day }. offset -1 = 전월, 0 = 당월. day 31 = 말일(짧은 달은 그 달 말일).
// - cycle.paymentDay: 청구월(결제가 이뤄지는 달)의 결제일.
// - cycle 이 없는 카드사(예: 남편, 체크카드)는 사용한 달 그대로 청구월로 봅니다.
// - 청구 묶음: 카드사가 있으면 카드사 하나로, 없으면 결제수단 하나로 묶습니다. 포인트(바우처)는 청구가 아니므로 뺍니다.
// - 취소는 기본값으로 계산한 청구월이 있고, 거래마다 직접 고칠 수 있습니다(cancel.billMonth).

import { cardDiscountOf as cardDiscount } from './ledger';

const pad = (n) => String(n).padStart(2, '0');

// 'YYYY-MM' 에 달 수를 더합니다.
export function addMonths(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

// 'YYYY-MM' 의 day 일을 'YYYY-MM-DD' 로 돌려줍니다. 31 이면 그 달의 말일입니다.
function dayOf(ym, day) {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return `${ym}-${pad(Math.min(day, last))}`;
}

// 이용기간 시작·끝 날짜 (청구월 B 기준)
function periodOf(B, cycle) {
  return {
    start: dayOf(addMonths(B, cycle.from.offset), cycle.from.day),
    end: dayOf(addMonths(B, cycle.to.offset), cycle.to.day),
  };
}

// 결제일 날짜 (청구월 B 기준)
export const paymentDateOf = (B, issuer) => dayOf(B, issuer.cycle.paymentDay);

// 거래 날짜(YYYY-MM-DD)가 속하는 청구월(YYYY-MM)
export function billingMonthOf(date, issuer) {
  const base = date.slice(0, 7);
  if (!issuer?.cycle) return base;
  for (const delta of [-1, 0, 1]) {
    const B = addMonths(base, delta);
    const { start, end } = periodOf(B, issuer.cycle);
    if (date >= start && date <= end) return B;
  }
  return base;
}

// 취소의 기본 청구월: 취소일이 원거래의 결제일 이전이면 원결제 청구월, 이후면 취소일이 속한 청구월.
// 사용월 기준 카드사는 취소한 달에 빠집니다.
export function suggestedCancelBillMonth(orig, cancel, issuer) {
  if (!issuer?.cycle) return cancel.date.slice(0, 7);
  const origB = billingMonthOf(orig.date, issuer);
  if (cancel.date < paymentDateOf(origB, issuer)) return origB;
  return billingMonthOf(cancel.date, issuer);
}

// 결제수단의 카드사 (없으면 null)
export const issuerOf = (payment, issuerById) =>
  (payment?.issuerId && issuerById[payment.issuerId]) || null;

// 결제수단이 속하는 청구 묶음. 포인트는 청구가 없으므로 null.
export function billingGroupOf(payment, issuerById) {
  if (!payment || payment.kind === 'point') return null;
  const issuer = issuerOf(payment, issuerById);
  if (issuer) return { key: `issuer:${issuer.id}`, name: issuer.name, issuer };
  return { key: `pay:${payment.id}`, name: payment.name, issuer: null };
}

// 청구월 B의 청구 합계.
// 거래는 청구 금액(할인 후), 취소는 그 반대 부호로 해당 청구월에 더합니다.
// 반환: groups (카드사·묶음별), byPayment (결제수단별 청구·할인)
export function billingFor(rows, payments, issuers, B) {
  const payById = Object.fromEntries(payments.map((p) => [p.id, p]));
  const issuerById = Object.fromEntries(issuers.map((i) => [i.id, i]));
  const rowById = Object.fromEntries(rows.map((r) => [r.id, r]));
  const groups = {};
  const byPayment = {};

  // excluded: 청구 미포함(billExcluded)인 거래. 청구 합계에서는 빼고, 할인 기록에는 그대로 남깁니다.
  const add = (group, payment, billed, discount, excluded) => {
    const bp = (byPayment[payment.id] ??= { billed: 0, discount: 0 });
    bp.discount += discount;
    if (excluded) return;
    const g = (groups[group.key] ??= { key: group.key, name: group.name, issuer: group.issuer, total: 0, lines: {} });
    g.total += billed;
    const line = (g.lines[payment.id] ??= { paymentId: payment.id, name: payment.name, billed: 0 });
    line.billed += billed;
    bp.billed += billed;
  };

  for (const r of rows) {
    if (r.type === 'expense') {
      const p = payById[r.paymentId];
      const group = billingGroupOf(p, issuerById);
      if (!group || billingMonthOf(r.date, group.issuer) !== B) continue;
      add(group, p, r.amount - cardDiscount(r), cardDiscount(r), !!r.billExcluded);
    } else if (r.type === 'cancel') {
      const orig = rowById[r.refId];
      const p = orig && payById[orig.paymentId];
      const group = billingGroupOf(p, issuerById);
      if (!group) continue;
      const cancelB = r.billMonth ?? suggestedCancelBillMonth(orig, r, group.issuer);
      if (cancelB !== B) continue;
      add(group, p, -(r.amount - cardDiscount(r)), -cardDiscount(r), !!r.billExcluded);
    }
  }

  const list = Object.values(groups)
    .map((g) => ({ ...g, lines: Object.values(g.lines).sort((a, b) => b.billed - a.billed) }))
    .sort((a, b) => b.total - a.total);
  return { groups: list, byPayment };
}

