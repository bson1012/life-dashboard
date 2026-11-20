// 가계부 기본 데이터(결제수단, 카테고리)를 저장소에 처음 한 번만 넣습니다.
// 이후에는 가계부 관리 팝업에서 직접 편집하며, 삭제한 기본값은 다시 생기지 않습니다.
import { repo } from './repository';
import { ADDED_PAYMENTS, DEFAULT_PAYMENTS } from '../config/payments';
import { EXPENSE_TREE, INCOME_TREE } from '../config/ledgerCategories';

const SEED_FLAG = 'lifeDashboard:seeded:money';
const ADDED_FLAG = 'lifeDashboard:seeded:money:added1';
let seeding = null;

export function ensureMoneySeed() {
  if (!seeding) seeding = seed().then(addMissingPayments);
  return seeding;
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
