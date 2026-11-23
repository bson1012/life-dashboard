// 가계부 기본 데이터(결제수단, 카테고리)를 저장소에 처음 한 번만 넣습니다.
// 이후에는 가계부 관리 팝업에서 직접 편집하며, 삭제한 기본값은 다시 생기지 않습니다.
import { repo } from './repository';
import { ADDED_PAYMENTS, DEFAULT_PAYMENTS } from '../config/payments';
import { EXPENSE_TREE, INCOME_TREE } from '../config/ledgerCategories';

const SEED_FLAG = 'lifeDashboard:seeded:money';
const ADDED_FLAG = 'lifeDashboard:seeded:money:added1';
let seeding = null;

export function ensureMoneySeed() {
  if (!seeding) seeding = seed().then(addMissingPayments).then(seedIssuers);
  return seeding;
}

// 카드사 기본값 (청구 기간과 결제일). 이후에는 가계부 관리 > 카드사 에서 바꿉니다.
// cycle 이 null 이면 사용한 달 그대로 청구합니다.
const ISSUER_SEED = [
  { name: '삼성', cycle: { from: { offset: -1, day: 13 }, to: { offset: 0, day: 12 }, paymentDay: 25 } },
  { name: '하나', cycle: { from: { offset: -1, day: 1 }, to: { offset: -1, day: 31 }, paymentDay: 13 } },
  { name: '현대', cycle: { from: { offset: -1, day: 1 }, to: { offset: -1, day: 31 }, paymentDay: 12 } },
  { name: '신한', cycle: { from: { offset: -1, day: 1 }, to: { offset: -1, day: 31 }, paymentDay: 14 } },
  { name: '남편', cycle: null },
];
const ISSUER_FLAG = 'lifeDashboard:seeded:issuers1';

// 카드사를 한 번 넣고, 이름이 카드사 이름으로 시작하는 신용카드를 그 카드사에 연결합니다.
// 연결은 기본값일 뿐이라서 이후에는 결제수단 편집에서 바꿀 수 있습니다.
async function seedIssuers() {
  if (localStorage.getItem(ISSUER_FLAG)) return;
  let issuers = await repo.list('cardIssuers');
  if (issuers.length === 0) {
    for (const i of ISSUER_SEED) await repo.create('cardIssuers', i);
    issuers = await repo.list('cardIssuers');
  }
  const payments = await repo.list('paymentMethods');
  for (const p of payments) {
    if (p.kind !== 'card' || p.issuerId) continue;
    const match = issuers.find((i) => p.name === i.name || p.name.startsWith(i.name + ' '));
    if (match) await repo.update('paymentMethods', p.id, { issuerId: match.id });
  }
  localStorage.setItem(ISSUER_FLAG, '1');
}

// 예전에 시드된 저장소에도 새로 추가된 기본 결제수단을 한 번 넣습니다. 같은 이름이 있으면 건너뜁니다.
async function addMissingPayments() {
  if (localStorage.getItem(ADDED_FLAG)) return;
  const current = await repo.list('paymentMethods');
  const have = new Set(current.map((p) => p.name));
  let order = current.length;
  for (const p of ADDED_PAYMENTS) {
    if (!have.has(p.name)) await repo.create('paymentMethods', { ...p, order: order++ });
  }
  localStorage.setItem(ADDED_FLAG, '1');
}

async function seed() {
  if (localStorage.getItem(SEED_FLAG)) return;

  if ((await repo.list('paymentMethods')).length === 0) {
    for (let i = 0; i < DEFAULT_PAYMENTS.length; i++) {
      await repo.create('paymentMethods', { ...DEFAULT_PAYMENTS[i], order: i });
    }
  }

  if ((await repo.list('ledgerCategories')).length === 0) {
    const trees = [
      ['expense', EXPENSE_TREE],
      ['income', INCOME_TREE],
    ];
    for (const [type, tree] of trees) {
      for (let i = 0; i < tree.length; i++) {
        await repo.create('ledgerCategories', { type, name: tree[i].name, subs: tree[i].subs, order: i });
      }
    }
  }

  localStorage.setItem(SEED_FLAG, '1');
}
