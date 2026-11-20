// 결제수단 설정. 처음 한 번만 저장소에 넣고(src/data/moneySeed.js), 이후에는 가계부 관리 팝업에서 편집합니다.
// 결제수단은 하나의 목록입니다. 남편 명의 카드나 현금도 같은 목록에 이름으로 구분해 넣습니다.
// kind: bank(통장) | cash(현금) | card(신용카드) | check(체크카드) | point(포인트)
// spend: 지출 입력에서 선택 가능 여부 / income: 수입 입력에서 선택 가능 여부
// tiers: 실적 구간 (만원). 혜택 정보는 추후 추가합니다.
// 현금(kind: 'cash')은 거래마다 현금 영수증 여부(receipt)를 가지며, 기본값은 X 입니다.

export const KIND_LABEL = {
  bank: '통장',
  cash: '현금',
  card: '신용카드',
  check: '체크카드',
  point: '포인트',
};

export const KIND_OPTIONS = Object.entries(KIND_LABEL).map(([v, label]) => ({ v, label }));

// 나중에 추가된 기본 결제수단. 기존 저장소에 같은 이름이 없을 때 한 번만 넣습니다(moneySeed.js).
export const ADDED_PAYMENTS = [
  { kind: 'bank', name: '새마을금고 입출금 통장', tiers: [], spend: true, income: true },
  { kind: 'bank', name: '새마을금고 카드 통장', tiers: [], spend: true, income: true },
];

export const DEFAULT_PAYMENTS = [
  { kind: 'bank', name: '현금 통장', tiers: [], spend: true, income: true },
  { kind: 'bank', name: '예적금 통장', tiers: [], spend: false, income: true },
  { kind: 'bank', name: '대출 통장', tiers: [], spend: false, income: false },
  { kind: 'cash', name: '현금', tiers: [], spend: true, income: true },
  { kind: 'card', name: '삼성 국민행복카드', tiers: [30, 60, 100], spend: true, income: false },
  { kind: 'point', name: '삼성 국민행복카드 바우처', tiers: [], spend: true, income: false },
  { kind: 'card', name: '삼성 신세계 SFC 7', tiers: [], spend: true, income: false },
  { kind: 'card', name: '삼성 & 마일리지 플래티넘', tiers: [], spend: true, income: false },
  { kind: 'card', name: '삼성 iD SIMPLE', tiers: [], spend: true, income: false },
  { kind: 'card', name: '하나 MG+ S', tiers: [30, 60, 100], spend: true, income: false },
  { kind: 'card', name: '현대 더그린', tiers: [50, 100, 200], spend: true, income: false },
  { kind: 'card', name: '신한 신세계 Best Fit', tiers: [30], spend: true, income: false },
  { kind: 'card', name: '신한 IKEA Family with', tiers: [30, 60, 120], spend: true, income: false },
  { kind: 'check', name: '새마을 카카오페이', tiers: [], spend: true, income: false },
  { kind: 'check', name: '새마을 올유닛', tiers: [], spend: true, income: false },
  { kind: 'check', name: '새마을 꿀', tiers: [], spend: true, income: false },
  // 남편 명의
  { kind: 'bank', name: '남편 현금 통장', tiers: [], spend: true, income: true },
  { kind: 'cash', name: '남편 현금 영수증', tiers: [], spend: true, income: true },
  { kind: 'card', name: '남편 신용카드', tiers: [], spend: true, income: false },
  { kind: 'check', name: '남편 체크카드', tiers: [], spend: true, income: false },
];

// 목록에 보일 때의 종류 순서: 신용카드 → 체크카드 → 현금계좌(통장·현금) → 포인트
const KIND_RANK = { card: 0, check: 1, bank: 2, cash: 2, point: 3 };

// 종류 순서로 먼저 정렬하고, 같은 종류 안에서는 기존 정렬 순서(order)를 유지합니다.
export const sortByKind = (list) =>
  [...list].sort((a, b) => (KIND_RANK[a.kind] ?? 9) - (KIND_RANK[b.kind] ?? 9));

// 이동 입력 목록: 계좌·현금을 먼저 보이고, 카드는 그 뒤에 보입니다. 카드도 목록에는 그대로 있습니다.
export const accountsFor = (list) => {
  const isAccount = (p) => p.kind === 'bank' || p.kind === 'cash';
  return [...sortByKind(list.filter(isAccount)), ...sortByKind(list.filter((p) => !isAccount(p)))];
};

// 거래 종류(지출/수입)에 맞는 결제수단 목록 (정렬 순서 유지)
export const paymentsFor = (list, type) =>
  list.filter((p) => (type === 'expense' ? p.spend : p.income));

export const tierText = (tiers) => (tiers?.length ? `실적 ${tiers.join(' / ')}만` : '');
