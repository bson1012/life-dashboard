import { useEffect, useMemo, useRef, useState } from 'react';
import { benefitsOf, rateText } from '../config/cardBenefits';
import { subsOf, treeNames } from '../config/ledgerCategories';
import { PAGES } from '../config/pages';
import { accountsFor, paymentsFor, sortByKind } from '../config/payments';
import { ensureMoneySeed } from '../data/moneySeed';
import { useCollection } from '../data/useCollection';
import { categoryColor } from '../utils/categoryColor';
import { benefitLeft, limitFor, recordFor, remainingLimit } from '../utils/discount';
import { formatMonthLabel, formatWon, monthStr, shiftMonth, todayStr } from '../utils/format';
import {
  actualOf,
  billedOf,
  cancelledOf,
  cardDiscountOf,
  discountWon,
  isDeductible,
  netExpenseOf,
  remainingOf,
  summarize,
  supportOf,
} from '../utils/ledger';
import { isCounted, perfOf } from '../utils/performance';
import { billingMonthOf, issuerOf, suggestedCancelBillMonth } from '../utils/billing';
import BillingPanel from './BillingPanel';
import AmountExtras from './AmountExtras';
import CategoryPie from './CategoryPie';
import ManageMoney, { FIXED_KIND_LABEL } from './ManageMoney';
import MoneyInput from './MoneyInput';
import PaymentFilter from './PaymentFilter';
import PaymentPicker from './PaymentPicker';
import PerformancePanel from './PerformancePanel';
import TransactionEdit from './TransactionEdit';

// 실적(카드 실적 조건)은 신용카드·체크카드에만 있습니다. 통장·현금·포인트에는 실적 칩을 보이지 않습니다.
import './Ledger.css';

const byOrder = (a, b) => (a.order ?? 1e9) - (b.order ?? 1e9);
const num = (v) => (v === '' || v == null ? 0 : Number(v));

// 입력 폼
// amount: 승인 금액. 부가 정보(AmountExtras): discountMode('rate' | 'won')와 discountValue, support(지원 금액),
// counts(실적 포함, 기본 켜짐), deductible(공제, 기본 켜짐), personal(보연 개인), receipt(현금 영수증)
const newForm = (type = 'expense', date = todayStr()) => ({
  type,
  date,
  merchant: '', // 사용처
  memo: '', // 내용
  category: '',
  sub: '',
  paymentId: '',
  amount: '',
  discountMode: 'rate',
  discountValue: '',
  support: '',
  benefit: '', // 카드 혜택 구분 key (없으면 빈 값)
  fromId: '', // 이동: 보내는 계좌
  toId: '', // 이동: 받는 계좌
  counts: true,
  deductible: true,
  personal: false,
  company: false,
  receipt: false,
});

// 고정 항목 한 건을 그 달의 거래 입력값으로 바꿉니다. 종류(지출·수입·이동)에 따라 모양이 다릅니다.
// 할인·지원은 0에서 시작하고, 달마다 거래에서 고칩니다.
function fixedRecordFor(f, month) {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  const base = {
    date: `${month}-${String(Math.min(f.day || 1, last)).padStart(2, "0")}`,
    amount: Number(f.amount) || 0,
    fixedId: f.id,
    fixedMonth: month,
  };
  const kind = f.kind ?? "expense";
  if (kind === "transfer") {
    return {
      ...base,
      type: "transfer",
      memo: [f.name, f.memo].filter(Boolean).join(" · "),
      fromId: f.fromId ?? "",
      toId: f.toId ?? "",
      paymentId: f.fromId ?? "",
      category: "",
      sub: "",
    };
  }
  const common = {
    ...base,
    type: kind === "income" ? "income" : "expense",
    merchant: f.name,
    memo: f.memo ?? "",
    category: f.category ?? "",
    sub: f.sub ?? "",
    paymentId: f.paymentId ?? "",
  };
  if (kind === "income") return common;
  return {
    ...common,
    cardDiscount: 0,
    discountMode: "rate",
    discountValue: 0,
    benefit: "",
    support: 0,
    counts: f.counts !== false,
    deductible: f.deductible !== false,
    personal: !!f.personal,
    company: !!f.company,
  };
}

// 거래 한 줄 표시: "대분류 · 소분류"
const labelOf = (r) => (r.sub ? `${r.category} · ${r.sub}` : r.category);

// 결제수단 표시: 현금이면 영수증 여부를 함께 표시
function paymentLabelOf(r, paymentById) {
  const p = paymentById[r.paymentId];
  if (!p) return '';
  if (p.kind === 'cash') return `${p.name} (영수증 ${r.receipt ? 'O' : 'X'})`;
  return p.name;
}

// 실제 사용 금액의 부호: 수입과 지출은 +, 취소는 -
// 내역 목록에서 고를 수 있는 구분
// 여러 개를 함께 고를 수 있습니다. 아무것도 고르지 않으면(전체) 모두 보입니다.
const LIST_FILTERS = [
  { v: 'income', label: '수입' },
  { v: 'shared', label: '지출' },
  { v: 'transfer', label: '이동' },
  { v: 'personal', label: '보연 개인' },
  { v: 'company', label: '회사 비용' },
];

// 취소는 원거래에 이미 반영되므로 월별 합계에서 다시 차감하지 않습니다.
const signedActual = (r, rows) => {
  if (r.type === 'cancel') return 0;
  if (r.type === 'income') return r.amount;
  if (r.type === 'expense') return actualOf(netExpenseOf(rows, r));
  return actualOf(r);
};

const sumOf = (rows) =>
  rows.reduce((s, r) => s + signedActual(r, rows), 0);

// 청구 금액도 원결제 월 기준 순액으로 계산합니다.
const billedSum = (rows) =>
  rows.reduce(
    (s, r) =>
      s + (r.type === 'expense' ? billedOf(netExpenseOf(rows, r)) : 0),
    0,
  );

// 카테고리 합계
function categoriesOf(rows) {
  const byCat = {};

  for (const r of rows) {
    if (r.type !== 'expense') continue;

    const amount = actualOf(netExpenseOf(rows, r));
    byCat[r.category] = (byCat[r.category] || 0) + amount;
  }

  return Object.entries(byCat)
    .filter(([, amt]) => amt > 0)
    .sort((a, b) => b[1] - a[1]);
}

export default function Ledger() {
  const txApi = useCollection('transactions');
  const payApi = useCollection('paymentMethods');
  const catApi = useCollection('ledgerCategories');
  const limitApi = useCollection('discountLimits'); // 카드별 월 할인 한도 { paymentId, month, limit }
  const issuerApi = useCollection('cardIssuers'); // 카드사 { name, cycle: 이용기간·결제일 또는 null }
  const [sideView, setSideView] = useState('perf'); // 오른쪽 열: 청구 | 실적 (기본: 실적)
  const issuers = issuerApi.rows;
  const issuerById = useMemo(() => Object.fromEntries(issuers.map((i) => [i.id, i])), [issuers]);
  const fixedApi = useCollection('fixedCosts'); // 매달 고정 지출 { name, amount, day, paymentId, memo, active }
  const [month, setMonth] = useState(monthStr());
  const [form, setForm] = useState(newForm());
  const [manageOpen, setManageOpen] = useState(false);
  const [manageTab, setManageTab] = useState('pay'); // 관리 팝업을 열 때 보여 줄 탭
  const [cancelDraft, setCancelDraft] = useState(null); // { id, amount, date, memo }
  const [editingId, setEditingId] = useState(null); // 수정 중인 거래 id
  const [typeFilters, setTypeFilters] = useState([]); // 내역 목록의 구분 (여러 개 선택, 빈 배열이면 전체)
  const [payFilter, setPayFilter] = useState('all'); // 내역 목록의 결제수단 ('all' 또는 결제수단 id)
  const [keyword, setKeyword] = useState(''); // 내역 목록 검색어 (사용처·내용·분류·결제수단·금액)

  // 처음 실행이면 기본 결제수단·카테고리를 저장소에 넣은 뒤 다시 읽습니다.
  const { reload: reloadPay } = payApi;
  const { reload: reloadCat } = catApi;
  useEffect(() => {
    ensureMoneySeed().then(() => {
      reloadPay();
      reloadCat();
    });
  }, [reloadPay, reloadCat]);

  const { rows, ready, add, remove, update } = txApi;
  const limitRows = limitApi.rows;
  const { expense, categories, list } = summarize(rows, month);
  const fixedActive = useMemo(
    () => [...fixedApi.rows].filter((f) => f.active !== false).sort(byOrder),
    [fixedApi.rows],
  );

  // 고정 지출: 시작한 달부터 달마다 지출 거래를 한 번 만듭니다. 만들어진 거래는 일반 지출과 똑같이 고칠 수 있습니다.
  // 사용자가 지운 달(skipped)은 다시 만들지 않습니다. 같은 달을 두 번 만들지 않도록 진행 중인 키를 기억합니다.
  const generating = useRef(new Set());
  useEffect(() => {
    if (!ready) return;
    for (const f of fixedActive) {
      if (f.startMonth && month < f.startMonth) continue;
      if ((f.skipped ?? []).includes(month)) continue;
      const key = `${f.id}:${month}`;
      if (generating.current.has(key)) continue;
      if (rows.some((r) => r.fixedId === f.id && r.fixedMonth === month)) continue;
      generating.current.add(key);
      add(fixedRecordFor(f, month));
    }
  }, [ready, fixedActive, month, rows, add]);

  const trees = useMemo(() => {
    const build = (type) =>
      catApi.rows
        .filter((c) => c.type === type)
        .sort(byOrder)
        .map((c) => ({ name: c.name, subs: c.subs ?? [] }));
    return { expense: build('expense'), income: build('income') };
  }, [catApi.rows]);

  const payments = useMemo(() => sortByKind([...payApi.rows].sort(byOrder)), [payApi.rows]);
  const paymentById = useMemo(() => Object.fromEntries(payments.map((p) => [p.id, p])), [payments]);
  const fixedRows = fixedActive;
  const fixedTotalOf = (kind) =>
    fixedRows.filter((f) => (f.kind ?? 'expense') === kind).reduce((s, f) => s + (Number(f.amount) || 0), 0);
  const rowById = useMemo(() => Object.fromEntries(rows.map((r) => [r.id, r])), [rows]);

  // 저장된 선택이 목록에 없으면 첫 항목으로 맞춥니다.
  const isExpense = form.type === 'expense';
  const isTransfer = form.type === 'transfer';
  const accounts = accountsFor(payments); // 이동 대상: 계좌·현금
  const tree = trees[form.type] ?? []; // 이동은 대분류가 없어서 빈 목록입니다.
  const category = tree.some((m) => m.name === form.category) ? form.category : (tree[0]?.name ?? '');
  const subs = subsOf(tree, category);
  const sub = subs.includes(form.sub) ? form.sub : (subs[0] ?? '');
  const choices = paymentsFor(payments, form.type);
  const paymentId = choices.some((p) => p.id === form.paymentId) ? form.paymentId : (choices[0]?.id ?? '');
  const selectedPayment = paymentById[paymentId];
  const counts = form.counts;

  // 실시간 계산: 승인 - 카드 할인 - 지원 = 실제 사용 금액
  const approvedN = num(form.amount);
  // 카드 혜택이 골라져 있으면 할인은 혜택 할인율 × 승인 금액을 이번 달 남은 한도 안에서 계산합니다.
  const benefits = benefitsOf(selectedPayment);
  const formMonth = form.date.slice(0, 7);
  const monthLimit = selectedPayment ? limitFor(limitRows, paymentId, formMonth) : 0;
  const leftLimit = remainingLimit({ rows, month: formMonth, paymentId, limit: monthLimit });
  const pickedBenefit = benefits.find((b) => b.key === form.benefit);
  const monthCaps = recordFor(limitRows, paymentId, formMonth)?.caps ?? {};
  const cap = pickedBenefit ? (monthCaps[pickedBenefit.key] ?? null) : null;
  const leftBenefit = pickedBenefit
    ? benefitLeft({ rows, month: formMonth, paymentId, cap, benefit: pickedBenefit })
    : null;
  const requestedDiscount = discountWon(
    approvedN,
    form.discountMode,
    num(form.discountValue),
  );

  // 혜택 분야를 선택한 경우에도 실제 입력한 할인값을 사용합니다.
  // 단, 통합 한도와 분야별 한도를 초과할 수 없습니다.
  const discountN = isExpense
    ? pickedBenefit
      ? Math.min(requestedDiscount, leftLimit, leftBenefit ?? Infinity)
      : requestedDiscount
    : 0;
  const supportN = isExpense ? num(form.support) : 0;
  const billedN = approvedN - discountN;
  const actualN = approvedN - discountN - supportN;

  const sortedList = [...list].sort(
    (a, b) => b.date.localeCompare(a.date) || (b.createdAt ?? '').localeCompare(a.createdAt ?? ''),
  );
  // 내역 구분: 수입 / 보연 개인 아닌 지출 / 보연 개인 지출 / 이동(계좌 간 이체)
  const isSpend = (r) => r.type === 'expense' || r.type === 'cancel';
  const incomeRows = sortedList.filter((r) => r.type === 'income');
  // 이번 달 전체 기준 (목록 필터와 무관): 공용 비용 = 보연 개인을 뺀 지출, 보연 개인 = 보연 개인 지출
  // 회사 비용은 공용·보연 개인 어디에도 넣지 않고, 구분별 합계에서 청구 금액으로만 따로 보여 줍니다.
  const monthShared = list.filter((r) => isSpend(r) && !r.personal && !r.company);
  const monthPersonal = list.filter((r) => isSpend(r) && r.personal && !r.company);
  const monthCompany = list.filter((r) => isSpend(r) && r.company);
  const sharedRows = sortedList.filter((r) => isSpend(r) && !r.personal && !r.company);
  const personalRows = sortedList.filter((r) => isSpend(r) && r.personal && !r.company);
  const transferRows = sortedList.filter((r) => r.type === 'transfer');

  // 대분류를 바꾸면 소분류는 그 대분류의 첫 항목으로 맞춥니다.
  function changeCategory(next) {
    setForm({ ...form, category: next, sub: '' });
  }

  function changeType(t) {
    setForm(newForm(t, form.date));
  }

  // 카드별 월 한도 저장: 같은 카드·같은 달 한 줄을 고쳐 씁니다.
  async function setLimit(pid, month, v) {
    const existing = limitRows.find((l) => l.paymentId === pid && l.month === month);
    if (existing) await limitApi.update(existing.id, { limit: v });
    else await limitApi.add({ paymentId: pid, month, limit: v });
  }

  // 이동: 계좌 A에서 계좌 B로 돈을 옮깁니다. 수입·지출 합계에는 들어가지 않습니다.
  async function submitTransfer() {
    if (!form.fromId || !form.toId) return window.alert('보내는 계좌와 받는 계좌를 골라 주세요.');
    if (form.fromId === form.toId) return window.alert('보내는 계좌와 받는 계좌가 같아요.');
    if (!(approvedN > 0)) return window.alert('이동 금액을 입력해 주세요.');
    await add({
      type: 'transfer',
      date: form.date,
      memo: form.memo.trim(),
      amount: approvedN,
      fromId: form.fromId,
      toId: form.toId,
      paymentId: form.fromId,
      category: '',
      sub: '',
    });
    setForm(newForm('transfer', form.date));
  }

  async function submit(e) {
    e.preventDefault();
    if (form.type === 'transfer') return submitTransfer();
    if (!selectedPayment || !category) return;
    if (!(approvedN > 0)) return window.alert('승인 금액을 입력해 주세요.');
    if (form.discountMode === 'rate' && num(form.discountValue) > 100) {
      return window.alert('할인율은 100% 이하로 입력해 주세요.');
    }
    if (discountN + supportN > approvedN) {
      return window.alert('카드 할인과 지원 금액의 합이 승인 금액을 넘을 수 없어요.');
    }
    if (isExpense && pickedBenefit && !monthLimit) {
      return window.alert('이번 달 할인 한도를 먼저 설정해 주세요. (관리 > 할인 한도)');
    }

    const record = {
      type: form.type,
      date: form.date,
      merchant: form.merchant.trim(),
      memo: form.memo.trim(),
      amount: approvedN,
      category,
      sub,
      paymentId,
    };
    if (isExpense) {
      record.cardDiscount = discountN;
      record.discountMode = form.discountMode;
      record.discountValue = num(form.discountValue);
      record.benefit = pickedBenefit?.key ?? '';
      record.support = supportN;
      record.deductible = form.deductible;
      record.personal = form.personal;
      record.company = form.company;
      record.counts = counts;
      if (selectedPayment.kind === 'cash') record.receipt = form.receipt;
    }
    await add(record);
    setForm(newForm(form.type, form.date));
  }

  function startCancel(r) {
    // 취소일 기본값: 이용이 발생한 날짜. 필요하면 폼에서 바꿀 수 있습니다.
    setCancelDraft({ id: r.id, amount: String(remainingOf(rows, r)), date: r.date, memo: '', billChoice: 'auto', perfCount: true, discountBack: true });
  }

  // 취소 청구월 선택지: 자동 추천, 원결제 청구월, 취소 청구월
  function cancelBillOptions(orig, date) {
    const issuer = issuerOf(paymentById[orig.paymentId], issuerById);
    const auto = suggestedCancelBillMonth(orig, { date }, issuer);
    const origB = billingMonthOf(orig.date, issuer);
    const cancelB = billingMonthOf(date, issuer);
    return [
      { v: 'auto', label: `자동 추천: ${auto}` },
      { v: origB, label: `원결제 청구월: ${origB}` },
      { v: cancelB, label: `취소 청구월: ${cancelB}` },
    ];
  }

  // 부분 취소 또는 전체 취소: 원래 지출에 연결된 취소 거래를 만듭니다.
  // 카드 할인과 지원 금액은 취소 금액의 비율만큼 함께 돌려받는 것으로 계산합니다.
  async function submitCancel(orig) {
    const amount = Number(cancelDraft.amount);
    const left = remainingOf(rows, orig);
    if (!amount || amount <= 0 || amount > left) {
      window.alert(`취소 금액은 1원 이상, 남은 금액(${formatWon(left)}) 이하로 입력해 주세요.`);
      return;
    }
    const cancelled = rows.filter(
      (r) => r.type === 'cancel' && r.refId === orig.id,
    );

    const alreadyDiscount = cancelled.reduce(
      (sum, r) => sum + cardDiscountOf(r),
      0,
    );

    const alreadySupport = cancelled.reduce(
      (sum, r) => sum + supportOf(r),
      0,
    );

    const remainingDiscount = Math.max(
      cardDiscountOf(orig) - alreadyDiscount,
      0,
    );

    const remainingSupport = Math.max(
      supportOf(orig) - alreadySupport,
      0,
    );

    const ratio = amount / left;

    const cancelDiscount =
      amount === left
        ? remainingDiscount
        : Math.min(remainingDiscount, Math.round(remainingDiscount * ratio));

    const cancelSupport =
      amount === left
        ? remainingSupport
        : Math.min(remainingSupport, Math.round(remainingSupport * ratio));

    // 청구월: 자동이면 null 로 두고 기본 규칙을 씁니다. 실적: 체크를 풀면 실적에서 빼지 않습니다.
    await add({
      type: 'cancel',
      refId: orig.id,
      billMonth: cancelDraft.billChoice === 'auto' ? null : cancelDraft.billChoice,
      perfOff: !cancelDraft.perfCount,
      date: cancelDraft.date,
      merchant: orig.merchant ?? '',
      memo: cancelDraft.memo.trim(),
      amount,
      // 할인 되돌리기를 끄면 이 취소는 할인 내역을 건드리지 않습니다(할인 0 으로 기록).
      cardDiscount: cancelDraft.discountBack === false ? 0 : cancelDiscount,
      support: cancelSupport,
      category: orig.category,
      sub: orig.sub ?? '',
      paymentId: orig.paymentId,
      counts: isCounted(orig, paymentById[orig.paymentId]),
      deductible: isDeductible(orig),
      personal: !!orig.personal,
      company: !!orig.company,
      benefit: orig.benefit ?? '',
    });
    setCancelDraft(null);
  }

  // 지출을 지우면 연결된 취소 거래도 함께 지웁니다.
  async function removeTx(r) {
    const children = rows.filter((x) => x.type === 'cancel' && x.refId === r.id);
    const msg = children.length
      ? `이 거래와 연결된 취소 ${children.length}건도 함께 삭제할까요?`
      : '이 거래를 삭제할까요?';
    if (!window.confirm(msg)) return;
    for (const c of children) await remove(c.id);
    // 고정 지출에서 만들어진 거래를 지우면, 그 달은 다시 만들지 않도록 기록합니다.
    if (r.fixedId) {
      const f = fixedApi.rows.find((x) => x.id === r.fixedId);
      if (f) await fixedApi.update(f.id, { skipped: [...(f.skipped ?? []), r.fixedMonth] });
    }
    await remove(r.id);
  }

  // 부가 정보 표시용: 할인 방식을 같이 보여줍니다.
  const discountText = (r) => {
    const won = cardDiscountOf(r);
    if (!won) return '';
    const bn = benefitsOf(paymentById[r.paymentId]).find((b) => b.key === r.benefit);
    const enteredValue = r.discountMode === 'rate'
      ? (r.discountValue ? `${r.discountValue}%` : '')
      : (Number(r.discountValue) > 0 ? formatWon(Number(r.discountValue)) : '');

    const rate = bn
      ? ` (${bn.label} ${enteredValue || rateText(bn)})`
      : r.discountMode === 'rate' && r.discountValue
        ? ` (${r.discountValue}%)`
        : '';
    return `카드 할인 ${formatWon(won)}${rate}`;
  };

  // 내역 한 줄. 수입, 지출, 취소 모두 같은 모양입니다. 이동은 From → To 로 따로 보여 줍니다.
  const renderRow = (r, nested = false) => {
    if (r.type === 'transfer') {
      const fromName = paymentById[r.fromId]?.name ?? '(삭제된 계좌)';
      const toName = paymentById[r.toId]?.name ?? '(삭제된 계좌)';
      return (
        <li key={r.id}>
          <div className="list-main">
            <div>
              <span className="tag transfer-tag">이동</span>
              <b className="merchant"> {fromName} → {toName}</b>
              {r.memo && <span className="memo"> {r.memo}</span>}
              {r.fixedId && <span className="memo"> · 고정</span>}
            </div>
            <small className="muted">{r.date}</small>
          </div>
          <div className="list-right">
            <b className="transfer-amt">⇄ {formatWon(r.amount)}</b>
            <button className="link-btn" onClick={() => setEditingId(r.id)}>수정</button>
            <button className="link-btn" onClick={() => removeTx(r)}>삭제</button>
          </div>
        </li>
      );
    }
    const isCancel = r.type === 'cancel';
    const isIncome = r.type === 'income';
    const orig = isCancel ? rowById[r.refId] : null;
    const pay = paymentById[r.paymentId];
    const left = r.type === 'expense' ? remainingOf(rows, r) : null;
    const cancelled = r.type === 'expense' ? cancelledOf(rows, r.id) : 0;
    const shown = r.type === 'expense' ? netExpenseOf(rows, r) : r;
    const sup = supportOf(shown);
    // 취소 행은 결제수단 자리에 '취소'를 보여 줍니다.
    const payText = isCancel ? '취소' : paymentLabelOf(r, paymentById);
    const dText = discountText(shown);
    // 카테고리명 색: 취소는 원래 거래의 대분류 색을 따릅니다.
    const catColor = categoryColor(isCancel ? (orig?.category ?? '') : r.category);
    return (
      <li key={r.id} className={[isCancel && 'cancel-row', nested && 'cancel-nested'].filter(Boolean).join(' ') || undefined}>
        <div className="list-main">
          <div className="money-tagline">
            <span
              className="tag category-tag"
              style={
                catColor.line
                  ? {
                    background: 'transparent',
                    color: catColor.fg,
                    border: `1px solid ${catColor.line}`,
                    opacity: isCancel ? 0.5 : 1,
                  }
                  : {
                    background: catColor.bg,
                    color: catColor.fg,
                    opacity: isCancel ? 0.5 : 1,
                  }
              }
            >
              {isCancel ? (orig ? labelOf(orig) : '취소 · (원거래 없음)') : labelOf(r)}
            </span>
            {r.fixedId && <span className="memo"> · 고정</span>}
          </div>
          <div className="money-body">
            {r.merchant && <b className="merchant"> {r.merchant}</b>}
            {r.memo && <span className="memo"> {r.memo}</span>}
          </div>
          <div className="money-pay">
            {!isIncome && !isCancel && (
              <span className="flag-row inline">
                {perfOf(pay) && isCounted(r, pay) && (
                  <button
                    className="flag-chip on"
                    onClick={() => update(r.id, { counts: !isCounted(r, pay) })}
                  >
                    실적
                  </button>
                )}
                {isDeductible(r) && (
                  <button className="flag-chip on" onClick={() => update(r.id, { deductible: false })}>
                    공제
                  </button>
                )}
                {r.personal && (
                  <button className="flag-chip on" onClick={() => update(r.id, { personal: false })}>
                    보연 개인
                  </button>
                )}
                {r.company && (
                  <button className="flag-chip on" onClick={() => update(r.id, { company: false })}>
                    회사 비용
                  </button>
                )}
              </span>
            )}
            {!isIncome && (
              <span className="flag-row inline">
                {/* 청구 미포함: 기본은 청구에 포함합니다. 현금으로 돌려받은 취소 등에 씁니다. */}
                <button
                  className={`flag-chip${r.billExcluded ? ' on' : ''}`}
                  onClick={() => update(r.id, { billExcluded: !r.billExcluded })}
                >
                  청구 제외
                </button>
              </span>
            )}
            {payText && <span className="memo">{payText}</span>}
            {cancelled > 0 && (
              <span className="memo cancel-status">
                {' '}
                {left === 0 ? '· 전체 취소' : `· 부분 취소 ${formatWon(cancelled)}, 잔액 ${formatWon(left)}`}
              </span>
            )}
          </div>
          <small className="muted money-due">
            {r.date} · 승인 {formatWon(isCancel ? r.amount : shown.amount)}
            {dText && ` · ${dText}`}
            {sup > 0 && ` · 지원 ${formatWon(sup)}`}
          </small>
        </div>
        <div className="list-right">
          <b className={isIncome ? 'income' : isCancel ? 'cancel-amt' : 'expense'}>
            {isIncome ? '+' : isCancel ? '' : '-'}
            {formatWon(
              isIncome
                ? r.amount
                : isCancel
                  ? actualOf(r)
                  : actualOf(shown),
            )}
          </b>
          {!isCancel && <button className="link-btn" onClick={() => setEditingId(r.id)}>수정</button>}
          {r.type === 'expense' && left > 0 && (
            <button className="link-btn" onClick={() => startCancel(r)}>취소</button>
          )}
          <button className="link-btn" onClick={() => removeTx(r)}>삭제</button>
        </div>
        {cancelDraft?.id === r.id && (
          <div className="cancel-inline">
            <CancelForm
              draft={cancelDraft}
              setDraft={setCancelDraft}
              onSubmit={() => submitCancel(r)}
              onClose={() => setCancelDraft(null)}
              left={remainingOf(rows, r)}
              title={labelOf(r)}
              billOptions={cancelBillOptions(r, cancelDraft.date)}
              perfApplies={isCounted(r, paymentById[r.paymentId])}
              discountApplies={cardDiscountOf(shown) > 0}
            />
          </div>
        )}
      </li>
    );
  };

  const matchesType = (r) => {
    if (typeFilters.length === 0) return true;
    return typeFilters.some((k) =>
      ({
        income: r.type === 'income',
        shared: isSpend(r) && !r.personal && !r.company,
        transfer: r.type === 'transfer',
        personal: isSpend(r) && !!r.personal,
        company: isSpend(r) && !!r.company,
      })[k],
    );
  };
  const listByType = sortedList.filter(matchesType);
  const toggleType = (v) =>
    setTypeFilters((cur) => (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]));
  // 결제수단별 필터: 'all'이면 그대로. 이동은 보내는 쪽과 받는 쪽 계좌 모두에 나타납니다.
  const listRows =
    payFilter === 'all'
      ? listByType
      : listByType.filter((r) => r.paymentId === payFilter || r.toId === payFilter);
  // 검색어: 사용처·내용·분류·결제수단 이름에 포함되거나, 숫자이면 금액이 같은 거래를 보여 줍니다.
  const kw = keyword.trim().toLowerCase();
  const matchesKeyword = (r) => {
    if (!kw) return true;
    const hay = [
      r.merchant,
      r.memo,
      r.category,
      r.sub,
      paymentById[r.paymentId]?.name,
      paymentById[r.toId]?.name,
      r.type === 'transfer' ? '이동' : '',
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    const digits = kw.replace(/[,\s원]/g, '');
    return hay.includes(kw) || (/^\d+$/.test(digits) && String(r.amount) === digits);
  };
  const searchedRows = listRows.filter(matchesKeyword);
  // 취소내역은 원거래가 목록에 있으면 날짜와 상관없이 원거래 바로 밑에 들여쓰기로 보여 줍니다.
  // 원거래가 목록에 없는 취소는 제자리(날짜순)에 그대로 둡니다.
  const shownIds = new Set(searchedRows.map((r) => r.id));
  const cancelsByOrig = new Map();
  for (const r of searchedRows) {
    if (r.type === 'cancel' && shownIds.has(r.refId)) {
      if (!cancelsByOrig.has(r.refId)) cancelsByOrig.set(r.refId, []);
      cancelsByOrig.get(r.refId).push(r);
    }
  }
  const topRows = searchedRows.filter((r) => !(r.type === 'cancel' && shownIds.has(r.refId)));
  const renderWithCancels = (r) => [
    renderRow(r),
    ...(cancelsByOrig.get(r.id) ?? []).map((c) => renderRow(c, true)),
  ];
  // 필터나 검색이 걸려 있으면 목록 아래에 그 결과의 합계를 보여 줍니다. 이동은 합계에 넣지 않고 따로 셉니다.
  const isFiltering = typeFilters.length > 0 || payFilter !== 'all' || kw !== '';
  const filteredNoTransfer = searchedRows.filter((r) => r.type !== 'transfer');
  const filteredIncome = sumOf(filteredNoTransfer.filter((r) => r.type === 'income'));
  const filteredSpend = sumOf(filteredNoTransfer.filter((r) => r.type === 'expense' || r.type === 'cancel'));
  const filteredTransfer = searchedRows.filter((r) => r.type === 'transfer').reduce((s, r) => s + r.amount, 0);
  const filteredNet = filteredIncome - filteredSpend;

  return (
    <div className="page">
      <div className="page-head">
        <h2>{PAGES.ledger.label}</h2>
        <div className="month-nav">
          <button className="icon-btn" onClick={() => setMonth(shiftMonth(month, -1))}>‹</button>
          <strong>{formatMonthLabel(month)}</strong>
          <button className="icon-btn" onClick={() => setMonth(shiftMonth(month, 1))}>›</button>
        </div>
        <button
          className="link-btn"
          onClick={() => {
            setManageTab('pay');
            setManageOpen(true);
          }}
        >
          관리
        </button>
      </div>

      <div className="money-stack">
        {/* Reminders 의 할 일 입력 줄과 같은 모양: 행마다 한 덩어리씩 */}
        <form className="card task-form money-form" onSubmit={submit}>
          <div className="task-row">
            <div className="segmented">
              {[
                ['expense', '지출'],
                ['income', '수입'],
                ['transfer', '이동'],
              ].map(([t, label]) => (
                <button type="button" key={t} className={form.type === t ? 'active' : ''} onClick={() => changeType(t)}>
                  {label}
                </button>
              ))}
            </div>
            <input
              type="date"
              className="title-input money-date"
              aria-label="날짜"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
            />
            <button className="btn-dark" type="submit">추가하기</button>
          </div>
          {isTransfer ? (
            <>
              <div className="task-row">
                <MoneyInput
                  className="title-input money-amount"
                  placeholder="이동 금액"
                  aria-label="이동 금액"
                  value={form.amount}
                  onChange={(v) => setForm({ ...form, amount: v })}
                />
                <select
                  className="title-input"
                  aria-label="보내는 계좌 (From)"
                  value={form.fromId}
                  onChange={(e) => setForm({ ...form, fromId: e.target.value })}
                >
                  <option value="">보내는 계좌 (From)</option>
                  {accounts.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div className="task-row">
                <select
                  className="title-input"
                  aria-label="받는 계좌 (To)"
                  value={form.toId}
                  onChange={(e) => setForm({ ...form, toId: e.target.value })}
                >
                  <option value="">받는 계좌 (To)</option>
                  {accounts.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <input
                  className="title-input"
                  placeholder="내용 (예: 공용비용 적립, 적금 이체)"
                  value={form.memo}
                  onChange={(e) => setForm({ ...form, memo: e.target.value })}
                />
              </div>
            </>
          ) : (
            <>
              <div className="task-row">
                <MoneyInput
                  className="title-input money-amount"
                  placeholder="승인 금액"
                  value={form.amount}
                  onChange={(v) => setForm({ ...form, amount: v })}
                />
                <PaymentPicker
                  options={choices}
                  value={paymentId}
                  onChange={(id) => setForm({ ...form, paymentId: id, receipt: false, benefit: '' })}
                />
              </div>
              <div className="task-row">
                <input
                  className="title-input"
                  placeholder="사용처"
                  value={form.merchant}
                  onChange={(e) => setForm({ ...form, merchant: e.target.value })}
                />
                <input
                  className="title-input"
                  placeholder="내용 (선택)"
                  value={form.memo}
                  onChange={(e) => setForm({ ...form, memo: e.target.value })}
                />
              </div>
              <div className="task-row">
                <select
                  className="title-input"
                  value={category}
                  onChange={(e) => changeCategory(e.target.value)}
                  aria-label="대분류"
                >
                  {treeNames(tree).map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
                <select
                  className="title-input"
                  value={sub}
                  onChange={(e) => setForm({ ...form, sub: e.target.value })}
                  aria-label="소분류"
                  disabled={subs.length === 0}
                >
                  {subs.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </div>
              {/* 요약 줄은 금액이 없어도 자리를 항상 차지해서, 입력할 때 칸 크기가 바뀌지 않게 합니다. */}
              <div className="money-summary">
                {isExpense && approvedN > 0 && (
                  <>
                    <span>실제 사용 <b>{formatWon(actualN)}</b></span>
                    {discountN > 0 && <span>청구 <b>{formatWon(billedN)}</b></span>}
                  </>
                )}
              </div>

              {isExpense && (
                <AmountExtras
                  form={{ ...form, counts, receipt: form.receipt }}
                  setForm={setForm}
                  showDiscount
                  showCounts={perfOf(selectedPayment)}
                  showReceipt={selectedPayment?.kind === 'cash'}
                  benefits={benefits}
                  monthLimit={monthLimit}
                  leftLimit={leftLimit}
                  leftBenefit={leftBenefit}
                  discountN={discountN}
                />
              )}

            </>
          )}
        </form>
      </div>

      <div className="money-wide">
        <div className="money-main-col">
          {/* 내역: 수입과 지출 전체를 한 목록으로 보고, 칩으로 구분만 골라 봅니다. 입력창 바로 아래에 둡니다. */}
          <div className="card">
            <div className="row-between" style={{ marginTop: 0 }}>
              <h3 style={{ margin: 0 }}>내역</h3>
              <div className="chip-bar">
                <button
                  className={`chip ${typeFilters.length === 0 ? 'active' : ''}`}
                  onClick={() => setTypeFilters([])}
                >
                  전체
                </button>
                {LIST_FILTERS.map((f) => (
                  <button
                    key={f.v}
                    className={`chip ${typeFilters.includes(f.v) ? 'active' : ''}`}
                    aria-pressed={typeFilters.includes(f.v)}
                    onClick={() => toggleType(f.v)}
                  >
                    {f.label}
                  </button>
                ))}
                <PaymentFilter
                  value={payFilter}
                  options={payments.map((p) => ({ id: p.id, name: p.name }))}
                  onChange={setPayFilter}
                />
                <input
                  type="search"
                  placeholder="검색: 사용처, 내용, 분류, 결제수단, 금액"
                  aria-label="내역 검색"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  style={{
                    width: 220,
                    maxWidth: '100%',
                    boxSizing: 'border-box',
                    margin: 0,
                    padding: '7px 14px',
                    border: '1px solid var(--line)',
                    borderRadius: 999,
                    background: 'var(--bg)',
                    color: 'inherit',
                    fontFamily: 'inherit',
                    fontSize: 14,
                    outline: 'none',
                  }}
                />
              </div>
            </div>
            {!ready ? null : searchedRows.length === 0 ? (
              <p className="muted">{kw ? '검색 결과가 없어요.' : '표시할 내역이 없어요.'}</p>
            ) : (
              <ul className="list">{topRows.flatMap(renderWithCancels)}</ul>
            )}
            {ready && isFiltering && searchedRows.length > 0 && (
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '6px 16px',
                  justifyContent: 'flex-end',
                  marginTop: 12,
                  paddingTop: 10,
                  borderTop: '1px solid var(--line)',
                  fontSize: 14,
                }}
              >
                <span className="muted">{searchedRows.length}건</span>
                <span>수입 <b>{formatWon(filteredIncome)}</b></span>
                <span>지출 <b>{formatWon(filteredSpend)}</b></span>
                {filteredTransfer > 0 && <span>이동 ⇄ <b>{formatWon(filteredTransfer)}</b></span>}
                <span>합계 <b>{formatWon(filteredNet)}</b></span>
              </div>
            )}
          </div>

          {/* 고정 지출: 매달 같은 항목이 보이도록 관리 > 고정 지출에 한 번만 입력합니다. 거래 합계에는 넣지 않습니다. */}
          <div className="card">
            <div className="row-between" style={{ marginTop: 0 }}>
              <h3 style={{ margin: 0 }}>고정 항목</h3>
              <small className="muted">
                매달 지출 {formatWon(fixedTotalOf('expense'))} · 수입 {formatWon(fixedTotalOf('income'))} · 이동 {formatWon(fixedTotalOf('transfer'))}
              </small>
            </div>
            {fixedRows.length === 0 ? (
              <p className="muted">등록된 고정 지출이 없어요.</p>
            ) : (
              <ul className="fixed-list">
                {fixedRows.map((f) => (
                  <li key={f.id} className="fixed-row">
                    <span>
                      <span className="tag category-tag" style={{ marginRight: 6 }}>{FIXED_KIND_LABEL[f.kind ?? 'expense']}</span>
                      {f.name}
                      {f.day ? <small className="muted"> · 매달 {f.day}일</small> : null}
                      {paymentById[f.paymentId] ? <small className="muted"> · {paymentById[f.paymentId].name}</small> : null}
                    </span>
                    <b>{formatWon(f.amount)}</b>
                  </li>
                ))}
              </ul>
            )}
            <div style={{ marginTop: 8 }}>
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  setManageTab('fixed');
                  setManageOpen(true);
                }}
              >
                고정 항목 관리
              </button>
            </div>
          </div>

        </div>
        <div className="money-side-col">
          {/* 청구(카드사별 합산, 청구월 기준)와 실적(사용한 달 기준)은 따로 봅니다. */}
          <div className="segmented side-switch">
            <button className={sideView === 'perf' ? 'active' : ''} onClick={() => setSideView('perf')}>
              실적
            </button>
            <button className={sideView === 'billing' ? 'active' : ''} onClick={() => setSideView('billing')}>
              청구 예정
            </button>
          </div>
          {sideView === 'billing' ? (
            <BillingPanel rows={rows} payments={payments} issuers={issuers} month={month} />
          ) : (
            <PerformancePanel
              rows={rows}
              payments={payments}
              issuers={issuers}
              month={month}
              limitRows={limitRows}
              onOpenLimits={() => {
                setManageTab('limit');
                setManageOpen(true);
              }}
            />
          )}
          {/* 통계: 카테고리별 지출 비율과 구분별 합계 */}
          <div className="ledger-split">
            <div className="card split-card">
              <div className="row-between" style={{ marginTop: 0 }}>
                <h3 style={{ margin: 0 }}>공용 비용 카테고리</h3>
                <small className="muted">{formatWon(sumOf(monthShared))}</small>
              </div>
              <CategoryPie items={categoriesOf(monthShared)} />
            </div>
            <div className="card split-card">
              <div className="row-between" style={{ marginTop: 0 }}>
                <h3 style={{ margin: 0 }}>보연 개인 카테고리</h3>
                <small className="muted">{formatWon(sumOf(monthPersonal))}</small>
              </div>
              <CategoryPie items={categoriesOf(monthPersonal)} />
            </div>
            <div className="card split-card">
              <h3 style={{ marginTop: 0 }}>구분별 합계</h3>
              <dl className="totals">
                <div><dt>수입</dt><dd>{formatWon(sumOf(incomeRows))}</dd></div>
                <div><dt>지출 (보연 개인 제외)</dt><dd>{formatWon(sumOf(sharedRows))}</dd></div>
                <div><dt>보연 개인 지출</dt><dd>{formatWon(sumOf(personalRows))}</dd></div>
                <div><dt>회사 비용 (청구 기준)</dt><dd>{formatWon(billedSum(monthCompany))}</dd></div>
                <div><dt>이동</dt><dd>{formatWon(sumOf(transferRows))}</dd></div>
              </dl>
            </div>
          </div>
        </div>
      </div>




      {editingId && rowById[editingId] && (
        <TransactionEdit
          row={rowById[editingId]}
          rows={rows}
          trees={trees}
          payments={payments}
          limitRows={limitRows}
          onSetLimit={setLimit}
          onClose={() => setEditingId(null)}
          onSave={async (patch) => {
            await update(editingId, patch);
            setEditingId(null);
          }}
        />
      )}

      {manageOpen && (
        <ManageMoney
          payApi={payApi}
          issuerApi={issuerApi}
          catApi={catApi}
          limitApi={limitApi}
          fixedApi={fixedApi}
          txApi={txApi}
          initialTab={manageTab}
          onClose={() => setManageOpen(false)}
        />
      )}
    </div>
  );
}


// 취소 입력 폼 (내역 아래에 펼쳐짐)
function CancelForm({ draft, setDraft, onSubmit, onClose, left, title, billOptions, perfApplies, discountApplies }) {
  return (
    <form
      className="card cancel-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <b>취소 등록: {title}</b>
      <small className="muted">남은 승인 금액 {formatWon(left)}</small>
      <MoneyInput
        placeholder="취소 금액"
        value={draft.amount}
        onChange={(v) => setDraft({ ...draft, amount: v })}
      />
      <button type="button" className="link-btn" onClick={() => setDraft({ ...draft, amount: String(left) })}>
        전체 취소
      </button>
      <input
        type="date"
        value={draft.date}
        onChange={(e) => setDraft({ ...draft, date: e.target.value, billChoice: 'auto' })}
      />
      <input
        placeholder="메모 (선택)"
        value={draft.memo}
        onChange={(e) => setDraft({ ...draft, memo: e.target.value })}
      />
      {billOptions && (
        <label className="cancel-option">
          청구 반영 월
          <select value={draft.billChoice} onChange={(e) => setDraft({ ...draft, billChoice: e.target.value })}>
            {billOptions.map((o) => (
              <option key={o.v} value={o.v}>{o.label}</option>
            ))}
          </select>
        </label>
      )}
      {perfApplies && (
        <label className="cancel-option">
          <input
            type="checkbox"
            checked={draft.perfCount}
            onChange={(e) => setDraft({ ...draft, perfCount: e.target.checked })}
          />
          실적에서 빼기
        </label>
      )}
      {discountApplies && (
        <label className="cancel-option">
          <input
            type="checkbox"
            checked={draft.discountBack !== false}
            onChange={(e) => setDraft({ ...draft, discountBack: e.target.checked })}
          />
          할인도 함께 되돌리기
        </label>
      )}
      <button className="btn-dark" type="submit">취소 확인</button>
      <button className="link-btn" type="button" onClick={onClose}>닫기</button>
    </form>
  );
}
