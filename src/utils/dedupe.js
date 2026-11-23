// 중복 방지와 정리: 결제수단·카드사는 같은 이름(공백·대소문자 무시)을 두 번 넣지 않습니다.
// 이미 중복된 데이터는 mergeDuplicates 로 하나로 합칩니다. 가장 먼저 만든 행을 남기고,
// 나머지가 가리키던 거래·고정 항목·할인 한도·카드사 연결을 남긴 행으로 옮긴 뒤 나머지는 지웁니다.
import { repo } from '../data/repository';

export const normName = (s) => String(s ?? '').replace(/\s+/g, '').toLowerCase();

// 대분류(카테고리)는 지출/수입 안에서 이름이 같으면 같은 것입니다.
export const categoryKey = (r) => {
  const n = normName(r.name);
  return n ? `${r.type}|${n}` : null;
};

// 같은 이름끼리 묶습니다(keyOf 로 묶는 기준을 바꿀 수 있습니다). 각 묶음은 먼저 만든 순서로 정렬합니다.
export function duplicateGroups(rows, keyOf = (r) => normName(r.name)) {
  const by = new Map();
  for (const r of rows) {
    const k = keyOf(r);
    if (!k) continue;
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(r);
  }
  return [...by.values()]
    .filter((g) => g.length > 1)
    .map((g) => [...g].sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? '')));
}

// 새로 넣거나 이름을 바꿀 때 다른 행과 이름이 겹치는지 봅니다.
export function isDuplicateName(rows, name, exceptId) {
  const k = normName(name);
  return !!k && rows.some((r) => r.id !== exceptId && normName(r.name) === k);
}

// 대분류 중복을 합칩니다. 남기는 대분류에 소분류를 모으고(같은 이름은 한 번만), 나머지는 지웁니다.
// 거래는 카테고리를 이름으로 기억하므로 옮길 것이 없습니다. 반환: 지운 대분류 수
export async function mergeCategoryDuplicates() {
  const rows = await repo.list('ledgerCategories');
  let removed = 0;
  for (const group of duplicateGroups(rows, categoryKey)) {
    const [keep, ...dups] = group;
    const subs = [];
    for (const s of [keep, ...dups].flatMap((c) => c.subs ?? [])) {
      if (!subs.some((x) => normName(x) === normName(s))) subs.push(s);
    }
    for (const d of dups) {
      await repo.remove('ledgerCategories', d.id);
      removed++;
    }
    await repo.update('ledgerCategories', keep.id, { subs });
  }
  return removed;
}

// 결제수단 id 를 가리키는 곳들
const PAY_REFS = [
  { collection: 'transactions', fields: ['paymentId', 'fromId', 'toId'] },
  { collection: 'fixedCosts', fields: ['paymentId', 'fromId', 'toId'] },
  { collection: 'discountLimits', fields: ['paymentId'], sameMonthClash: true },
];

// 중복을 합칩니다. 반환: 지운 결제수단 수, 지운 카드사 수
export async function mergeDuplicates() {
  const issuers = await repo.list('cardIssuers');
  let removedIssuers = 0;
  for (const group of duplicateGroups(issuers)) {
    const [keep, ...dups] = group;
    for (const d of dups) {
      const payments = await repo.list('paymentMethods');
      for (const p of payments.filter((x) => x.issuerId === d.id)) {
        await repo.update('paymentMethods', p.id, { issuerId: keep.id });
      }
      await repo.remove('cardIssuers', d.id);
      removedIssuers++;
    }
  }

  let removedPayments = 0;
  for (const group of duplicateGroups(await repo.list('paymentMethods'))) {
    const [keep, ...dups] = group;
    for (const d of dups) {
      const current = (await repo.list('paymentMethods')).find((p) => p.id === keep.id) ?? keep;
      if (!current.issuerId && d.issuerId) {
        await repo.update('paymentMethods', keep.id, { issuerId: d.issuerId });
      }
      for (const ref of PAY_REFS) {
        const rows = await repo.list(ref.collection);
        for (const r of rows) {
          const hits = ref.fields.filter((f) => r[f] === d.id);
          if (hits.length === 0) continue;
          if (ref.sameMonthClash && rows.some((x) => x.id !== r.id && x.paymentId === keep.id && x.month === r.month)) {
            // 남길 결제수단에 같은 달 한도가 이미 있으면 중복 한도는 지웁니다.
            await repo.remove(ref.collection, r.id);
            continue;
          }
          const patch = {};
          for (const f of hits) patch[f] = keep.id;
          await repo.update(ref.collection, r.id, patch);
        }
      }
      await repo.remove('paymentMethods', d.id);
      removedPayments++;
    }
  }

  return { removedPayments, removedIssuers };
}
