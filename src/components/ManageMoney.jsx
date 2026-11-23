import { useState } from 'react';
import MoneyInput from './MoneyInput';
import { accountsFor, KIND_OPTIONS, sortByKind, tierText } from '../config/payments';
import { categoryKey, duplicateGroups, isDuplicateName, mergeCategoryDuplicates, mergeDuplicates, normName } from '../utils/dedupe';
import { formatWon } from '../utils/format';
import { perfOf } from '../utils/performance';
import { benefitsOf, limitsOf, rateText } from '../config/cardBenefits';
import { EXPENSE_TREE, INCOME_TREE, subsOf, treeNames } from '../config/ledgerCategories';
import { parseBulk } from '../utils/bulkImport';
import './ManageMoney.css';

const byOrder = (a, b) =>
  (a.order ?? 1e9) - (b.order ?? 1e9) || (a.createdAt ?? '').localeCompare(b.createdAt ?? '');

// 목록을 new 순서대로 저장합니다. 바뀐 항목만 order 값(0,1,2…)을 갱신합니다.
async function saveOrder(api, arr) {
  for (let i = 0; i < arr.length; i++) {
    if (arr[i].order !== i) await api.update(arr[i].id, { order: i });
  }
}

// from 위치의 항목을 to 위치로 옮깁니다.
function moved(arr, fromIdx, toIdx) {
  const next = [...arr];
  const [item] = next.splice(fromIdx, 1);
  next.splice(toIdx, 0, item);
  return next;
}

// 같은 이름의 결제수단·카드사가 있으면 알려 주고, 한 번에 합칠 수 있게 합니다.
function DuplicateBanner({ payApi, issuerApi, catApi, txApi, limitApi, fixedApi }) {
  const [busy, setBusy] = useState(false);
  const payGroups = duplicateGroups(payApi.rows).length;
  const issuerGroups = duplicateGroups(issuerApi.rows).length;
  const catGroups = duplicateGroups(catApi?.rows ?? [], categoryKey).length;
  if (payGroups + issuerGroups + catGroups === 0) return null;

  async function merge() {
    if (!window.confirm('같은 이름으로 중복된 항목을 하나로 합칠까요?\n거래, 한도, 고정 항목은 남는 항목으로 옮겨집니다.')) return;
    setBusy(true);
    try {
      const r = await mergeDuplicates();
      const cat = await mergeCategoryDuplicates();
      await Promise.all([payApi, issuerApi, catApi, txApi, limitApi, fixedApi].filter(Boolean).map((a) => a.reload()));
      window.alert(`결제수단 ${r.removedPayments}개, 카드사 ${r.removedIssuers}개, 카테고리 ${cat}개를 합쳤어요.`);
    } catch (e) {
      window.alert(`정리하는 중 문제가 생겼어요: ${e.message}`);
    }
    setBusy(false);
  }

  return (
    <div className="card dup-banner">
      <span>
        같은 이름이 두 번 들어간 항목이 있어요
        {payGroups > 0 && ` · 결제수단 ${payGroups}개`}
        {issuerGroups > 0 && ` · 카드사 ${issuerGroups}개`}
        {catGroups > 0 && ` · 카테고리 ${catGroups}개`}
      </span>
      <button className="btn-dark" onClick={merge} disabled={busy}>
        {busy ? '정리 중…' : '중복 합치기'}
      </button>
    </div>
  );
}

// 가계부 관리 팝업: 결제수단 / 카테고리
export default function ManageMoney({ payApi, issuerApi, catApi, limitApi, fixedApi, txApi, initialTab = 'pay', onClose }) {
  const [tab, setTab] = useState(initialTab);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal card manage-modal" onClick={(e) => e.stopPropagation()}>
        <div className="row-between" style={{ marginTop: 0 }}>
          <h3 style={{ margin: 0 }}>가계부 관리</h3>
          <button className="link-btn" onClick={onClose}>닫기</button>
        </div>
        <div className="segmented manage-tabs">
          {[
            ['pay', '결제수단'],
            ['issuer', '카드사'],
            ['cat', '카테고리'],
            ['limit', '할인 한도'],
            ['fixed', '고정 지출'],
            ['bulk', '일괄 추가'],
          ].map(([t, label]) => (
            <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              {label}
            </button>
          ))}
        </div>
        <DuplicateBanner
          payApi={payApi}
          issuerApi={issuerApi}
          catApi={catApi}
          txApi={txApi}
          limitApi={limitApi}
          fixedApi={fixedApi}
        />
        {tab === 'pay' && <PaymentManager api={payApi} issuerApi={issuerApi} />}
        {tab === 'issuer' && <IssuerManager api={issuerApi} payApi={payApi} />}
        {tab === 'cat' && <CategoryManager api={catApi} />}
        {tab === 'limit' && <LimitManager api={limitApi} payApi={payApi} />}
        {tab === 'fixed' && <FixedManager api={fixedApi} payApi={payApi} catApi={catApi} />}
        {tab === 'bulk' && <BulkImport txApi={txApi} payApi={payApi} />}
      </div>
    </div>
  );
}

const BLANK_PAY = {
  kind: 'card',
  name: '',
  issuerId: '',
  tiers: '',
  spend: true,
  income: false,
  perf: true,
  benefits: [],
  totalLimits: [],
};
const BLANK_BENEFIT = { key: '', label: '', unit: 'percent', rate: '', examples: '', limitOptions: '' };
const BLANK_TOTAL = '';

// "4000, 8000" 같은 입력을 원 단위 숫자 목록으로 바꿉니다.
const parseWonList = (s) =>
  s
    .split(/[,\s/]+/)
    .map((x) => Number(x.replace(/[^0-9]/g, '')))
    .filter((n) => n > 0)
    .sort((a, b) => a - b);

const setAt = (arr, i, v) => arr.map((x, j) => (j === i ? v : x));
const dropAt = (arr, i) => arr.filter((_, j) => j !== i);

// 중복 판별용 키: 날짜·타입·금액·사용처·결제수단이 같으면 같은 거래로 봅니다.
// 이동 거래는 사용처를 memo 에 담고, 보내는 계좌를 paymentId 에 둡니다.
const keyOf = (t) =>
  [t.date, t.type, t.amount, (t.type === 'transfer' ? t.memo : t.merchant) ?? '', t.paymentId ?? ''].join('|');

// 표 한 행을 거래 입력값으로 바꿉니다.
function recordOf(r) {
  if (r.type === 'transfer') {
    return {
      type: 'transfer',
      date: r.date,
      memo: r.merchant,
      amount: r.amount,
      fromId: r.paymentId,
      toId: r.toId,
      paymentId: r.paymentId,
      category: '',
      sub: '',
    };
  }
  const base = {
    type: r.type,
    date: r.date,
    merchant: r.merchant,
    memo: '',
    amount: r.amount,
    category: r.category,
    sub: r.sub,
    paymentId: r.paymentId,
  };
  if (r.type === 'income') return base;
  return {
    ...base,
    cardDiscount: 0,
    discountMode: 'rate',
    discountValue: 0,
    benefit: '',
    support: 0,
    deductible: true,
    personal: false,
    company: false,
    counts: true,
    receipt: false,
  };
}

// 기본 카테고리: 지출은 기타 지출, 수입은 기타 수입입니다. 사용처에 '급여'가 있으면 주수입 급여로 둡니다.
function defaultCategoryOf(r) {
  if (r.type === 'income') {
    return r.merchant.includes('급여') ? { category: '주수입', sub: '급여' } : { category: '기타 수입', sub: '기타' };
  }
  return { category: '기타 지출', sub: '기타' };
}

// 대분류에 맞는 소분류 기본값: '기타'가 있으면 그것, 없으면 첫 번째 항목입니다.
const defaultSubOf = (tree, major) => {
  const subs = subsOf(tree, major);
  return subs.includes('기타') ? '기타' : (subs[0] ?? '');
};

// 붙여넣은 표를 미리 보고, 확인 후 거래로 한꺼번에 추가합니다.
function BulkImport({ txApi, payApi }) {
  const [text, setText] = useState('');
  const [items, setItems] = useState(null); // 미리보기 행 목록
  const [busy, setBusy] = useState(false);

  function preview() {
    const parsed = parseBulk(text, payApi.rows);
    if (!parsed.length) return window.alert('붙여넣은 내용이 없어요.');
    const existing = new Set(txApi.rows.map(keyOf));
    setItems(
      parsed.map((r) => {
        const cat = r.type === 'transfer' ? { category: '', sub: '', toId: '' } : defaultCategoryOf(r);
        const duplicate = !r.error && existing.has(keyOf(recordOf(r)));
        return {
          ...r,
          ...cat,
          duplicate,
          // 이동은 받는 계좌를 고르기 전까지 추가하지 않습니다.
          include: !r.error && !duplicate && r.type !== 'transfer',
        };
      }),
    );
  }

  function pickTo(i, toId) {
    const r = items[i];
    setItem(i, { toId, include: !r.error && !r.duplicate && !!toId });
  }

  function setItem(i, patch) {
    setItems((prev) => prev.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  }

  function changeMajor(i, major) {
    const tree = items[i].type === 'income' ? INCOME_TREE : EXPENSE_TREE;
    setItem(i, { category: major, sub: defaultSubOf(tree, major) });
  }

  async function save() {
    const picked = items.filter((x) => x.include && !x.error);
    if (!picked.length) return window.alert('저장할 항목을 골라 주세요.');
    if (!window.confirm(`${picked.length}건을 추가할까요?`)) return;
    setBusy(true);
    try {
      for (const r of picked) await txApi.add(recordOf(r));
      window.alert(`${picked.length}건을 추가했어요.`);
      setItems(null);
      setText('');
    } finally {
      setBusy(false);
    }
  }

  const okCount = items ? items.filter((x) => x.include && !x.error).length : 0;
  const errCount = items ? items.filter((x) => x.error).length : 0;
  const dupCount = items ? items.filter((x) => x.duplicate).length : 0;

  return (
    <div className="manage-body">
      <p className="muted" style={{ margin: '4px 0 8px' }}>
        엑셀이나 시트에서 표를 복사해 붙여넣으세요. 열 순서는 <b>날짜 · 타입 · 사용처 · 금액 · 화폐 · 결제수단</b>이며
        타입은 지출·수입·이체입니다. 이체는 이동으로 넣으며, 받는 계좌를 골라야 추가됩니다. 결제수단 이름은 결제수단 관리와 똑같아야 합니다.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={8}
        placeholder={'날짜\t타입\t사용처\t금액\t화폐\t결제수단\n2026-11-20\t지출\t쿠팡\t3730\tKRW\t하나 MG+ S'}
        style={{ width: '100%', fontFamily: 'inherit', fontSize: 13 }}
      />
      <div className="row-between" style={{ marginTop: 8 }}>
        <small className="muted">
          {items ? `${items.length}건 · 추가 ${okCount}건 · 중복 의심 ${dupCount}건 · 오류 ${errCount}건` : ''}
        </small>
        <button className="btn-dark" onClick={preview} disabled={!text.trim()}>
          미리보기
        </button>
      </div>

      {items && (
        <>
          <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0', display: 'grid', gap: 8 }}>
            {items.map((r, i) => {
              const tree = r.type === 'income' ? INCOME_TREE : EXPENSE_TREE;
              return (
                <li key={r.no} className="card" style={{ padding: 10, opacity: r.include ? 1 : 0.6 }}>
                  <div className="row-between" style={{ gap: 8, alignItems: 'flex-start' }}>
                    <label style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                      <input
                        type="checkbox"
                        disabled={!!r.error}
                        checked={r.include}
                        onChange={(e) => setItem(i, { include: e.target.checked })}
                      />
                      <span>
                        <small className="muted">
                          {r.no}행 · {r.date || '날짜 없음'} · {r.rawType || '타입 없음'}
                        </small>
                        <br />
                        <b>{r.merchant || '(사용처 없음)'}</b>{' '}
                        <span>{r.amount ? `${formatWon(r.amount)}` : ''}</span>
                        <br />
                        <small className="muted">{r.paymentName || '결제수단 없음'}</small>
                      </span>
                    </label>
                  </div>
                  {r.error && <small style={{ color: '#b3261e' }}>{r.error}</small>}
                  {r.duplicate && <small style={{ color: '#8a6408' }}>같은 거래가 이미 있어요. 넣으려면 체크하세요.</small>}
                  {!r.error && r.type === 'transfer' && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      <small className="muted">받는 계좌</small>
                      <select value={r.toId} onChange={(e) => pickTo(i, e.target.value)} aria-label="받는 계좌">
                        <option value="">고르세요</option>
                        {accountsFor(payApi.rows)
                          .filter((p) => p.id !== r.paymentId)
                          .map((p) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                      </select>
                    </div>
                  )}
                  {!r.error && r.type !== 'transfer' && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                      <select value={r.category} onChange={(e) => changeMajor(i, e.target.value)} aria-label="대분류">
                        {treeNames(tree).map((n) => (
                          <option key={n} value={n}>{n}</option>
                        ))}
                      </select>
                      {subsOf(tree, r.category).length > 0 && (
                        <select value={r.sub} onChange={(e) => setItem(i, { sub: e.target.value })} aria-label="소분류">
                          {subsOf(tree, r.category).map((s) => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="row-between">
            <button className="link-btn" onClick={() => setItems(null)}>목록 지우기</button>
            <button className="btn-dark" onClick={save} disabled={busy || okCount === 0}>
              {busy ? '추가하는 중…' : `${okCount}건 추가하기`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function PaymentManager({ api, issuerApi }) {
  const [form, setForm] = useState(BLANK_PAY);
  const [editingId, setEditingId] = useState(null);
  const [dragId, setDragId] = useState(null);
  const rows = [...api.rows].sort(byOrder);
  const issuers = [...(issuerApi?.rows ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  const issuerNameOf = (id) => issuers.find((i) => i.id === id)?.name;

  function reset() {
    setForm(BLANK_PAY);
    setEditingId(null);
  }

  function startEdit(p) {
    setEditingId(p.id);
    setForm({
      kind: p.kind,
      name: p.name,
      issuerId: p.issuerId ?? '',
      tiers: (p.tiers ?? []).join(', '),
      spend: !!p.spend,
      income: !!p.income,
      perf: perfOf(p),
      benefits: (p.benefits ?? []).map((b) => ({
        key: b.key,
        label: b.label,
        unit: b.unit ?? 'percent',
        rate: String(b.rate),
        examples: b.examples ?? '',
        limitOptions: (b.limitOptions ?? []).join(', '),
      })),
      totalLimits: (p.totalLimitOptions ?? []).map(String),
    });
  }

  async function save(e) {
    e.preventDefault();
    const name = form.name.trim();
    if (!name) return;
    if (isDuplicateName(api.rows, name, editingId)) {
      return window.alert(`"${name}" 결제수단이 이미 있어요. 기존 항목을 수정해 주세요.`);
    }
    // 신용카드와 체크카드는 같은 할인 혜택·월 통합 한도 규칙을 씁니다.
    const isCard = form.kind === 'card' || form.kind === 'check';
    const data = {
      kind: form.kind,
      name,
      // 카드사는 신용카드에만 연결합니다. 없으면 null (청구 묶음이 결제수단 하나가 됩니다).
      issuerId: form.kind === 'card' && form.issuerId ? form.issuerId : null,
      tiers: form.tiers.split(/[,\s/]+/).map(Number).filter((n) => n > 0),
      spend: form.spend,
      income: form.income,
      perf: form.perf,
      // 할인 혜택 규칙(참고용): 카드만 씁니다. 이름과 할인율이 있는 줄만 저장합니다.
      // 키는 이름을 그대로 씁니다. 같은 이름으로 다시 입력해도 기존 거래의 혜택 구분이 이어집니다.
      benefits: isCard
        ? form.benefits
            .filter((b) => b.label.trim() && Number(b.rate) > 0)
            .map((b) => ({
              key: b.key || b.label.trim(),
              label: b.label.trim(),
              unit: b.unit === 'won' ? 'won' : 'percent',
              rate: Number(b.rate),
              examples: b.examples.trim(),
              limitOptions: parseWonList(b.limitOptions),
            }))
        : [],
      totalLimitOptions: isCard ? parseWonList(form.totalLimits.join(',')) : [],
    };
    if (editingId) await api.update(editingId, data);
    else await api.add({ ...data, order: rows.length });
    reset();
  }

  async function remove(p) {
    if (!window.confirm(`"${p.name}" 결제수단을 삭제할까요? 기존 거래의 결제수단 표시도 사라집니다.`)) return;
    await api.remove(p.id);
    if (editingId === p.id) reset();
  }

  async function dropOn(targetId) {
    const from = rows.findIndex((r) => r.id === dragId);
    const to = rows.findIndex((r) => r.id === targetId);
    setDragId(null);
    if (from < 0 || to < 0 || from === to) return;
    await saveOrder(api, moved(rows, from, to));
  }

  return (
    <>
      <form className="manage-form" onSubmit={save}>
        <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} aria-label="종류">
          {KIND_OPTIONS.map((k) => (
            <option key={k.v} value={k.v}>{k.label}</option>
          ))}
        </select>
        <input
          placeholder="이름 (예: 남편 신용카드, 신한 신세계 Best Fit)"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        {form.kind === 'card' && (
          <select
            value={form.issuerId}
            onChange={(e) => setForm({ ...form, issuerId: e.target.value })}
            aria-label="카드사"
          >
            <option value="">카드사 없음 (사용한 달 그대로)</option>
            {issuers.map((i) => (
              <option key={i.id} value={i.id}>{i.name}</option>
            ))}
          </select>
        )}
        <input
          className="wide"
          placeholder="실적 구간, 만원 단위 (예: 30, 60, 100) — 없으면 비워 두세요"
          value={form.tiers}
          onChange={(e) => setForm({ ...form, tiers: e.target.value })}
        />
        {(form.kind === 'card' || form.kind === 'check') && (
          <>
            <div className="rule-block wide">
              <div className="rule-title">
                할인 혜택 <small className="muted">거래마다 고르는 구분과 할인율</small>
              </div>
              {form.benefits.map((b, i) => (
                <div className="rule-row" key={b.key || `new-${i}`}>
                  <input
                    placeholder="구분 (예: 쇼핑)"
                    value={b.label}
                    onChange={(e) => setForm({ ...form, benefits: setAt(form.benefits, i, { ...b, label: e.target.value }) })}
                  />
                  <div className="rate-input">
                    <select
                      value={b.unit}
                      aria-label="할인 방식"
                      onChange={(e) => setForm({ ...form, benefits: setAt(form.benefits, i, { ...b, unit: e.target.value }) })}
                    >
                      <option value="percent">%</option>
                      <option value="won">원</option>
                    </select>
                    <input
                      type="number"
                      inputMode="decimal"
                      placeholder={b.unit === 'won' ? '할인 금액 (원, 건당)' : '할인율 %'}
                      value={b.rate}
                      onChange={(e) => setForm({ ...form, benefits: setAt(form.benefits, i, { ...b, rate: e.target.value }) })}
                    />
                  </div>
                  <input
                    placeholder="분야 한도 옵션 (원, 쉼표) 예: 4000, 8000"
                    value={b.limitOptions}
                    onChange={(e) =>
                      setForm({ ...form, benefits: setAt(form.benefits, i, { ...b, limitOptions: e.target.value }) })
                    }
                  />
                  <button type="button" className="link-btn" onClick={() => setForm({ ...form, benefits: dropAt(form.benefits, i) })}>
                    삭제
                  </button>
                  <input
                    className="rule-examples"
                    placeholder="사용처 (참고용, 선택) 예: 네이버페이, 카카오페이, 토스페이"
                    value={b.examples}
                    onChange={(e) => setForm({ ...form, benefits: setAt(form.benefits, i, { ...b, examples: e.target.value }) })}
                  />
                </div>
              ))}
              <button
                type="button"
                className="link-btn"
                onClick={() => setForm({ ...form, benefits: [...form.benefits, { ...BLANK_BENEFIT }] })}
              >
                + 혜택 추가
              </button>
            </div>

            <div className="rule-block wide">
              <div className="rule-title">
                월 통합 한도 옵션 <small className="muted">그 달에 고를 수 있는 통합 한도 (달마다 실제 값은 할인 한도 탭에서 입력)</small>
              </div>
              {form.totalLimits.map((t, i) => (
                <div className="rule-row rule-row-one" key={`total-${i}`}>
                  <MoneyInput
                    placeholder="통합 한도 (원)"
                    value={t}
                    onChange={(v) => setForm({ ...form, totalLimits: setAt(form.totalLimits, i, v) })}
                  />
                  <button type="button" className="link-btn" onClick={() => setForm({ ...form, totalLimits: dropAt(form.totalLimits, i) })}>
                    삭제
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="link-btn"
                onClick={() => setForm({ ...form, totalLimits: [...form.totalLimits, BLANK_TOTAL] })}
              >
                + 통합 한도 옵션 추가
              </button>
            </div>
          </>
        )}
        <div className="manage-flags wide">
          <label>
            <input type="checkbox" checked={form.spend} onChange={(e) => setForm({ ...form, spend: e.target.checked })} />
            지출에 사용
          </label>
          <label>
            <input type="checkbox" checked={form.income} onChange={(e) => setForm({ ...form, income: e.target.checked })} />
            수입 받기
          </label>
          <label>
            <input type="checkbox" checked={form.perf} onChange={(e) => setForm({ ...form, perf: e.target.checked })} />
            실적 관리
          </label>
          <span className="manage-form-buttons">
            {editingId && <button type="button" className="link-btn" onClick={reset}>취소</button>}
            <button className="btn-dark" type="submit">{editingId ? '저장' : '추가'}</button>
          </span>
        </div>
      </form>

      {rows.length === 0 && <p className="muted">등록된 결제수단이 없어요.</p>}
      {rows.map((p) => (
        <div
          className={`manage-row ${dragId === p.id ? 'dragging' : ''}`}
          key={p.id}
          draggable
          onDragStart={() => setDragId(p.id)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => dropOn(p.id)}
          onDragEnd={() => setDragId(null)}
        >
          <span className="grip" aria-hidden="true">⠿</span>
          <div className="grow">
            <b>{p.name}</b>{' '}
            <small className="muted">
              {KIND_OPTIONS.find((k) => k.v === p.kind)?.label}
              {issuerNameOf(p.issuerId) && ` · ${issuerNameOf(p.issuerId)}`}
              {tierText(p.tiers) && ` · ${tierText(p.tiers)}`}
              {p.benefits?.length > 0 && ` · 혜택 ${p.benefits.map((b) => `${b.label} ${rateText(b)}`).join(', ')}`}
              {p.totalLimitOptions?.length > 0 && ` · 통합 한도 옵션 ${p.totalLimitOptions.map((v) => formatWon(v)).join(' / ')}`}
              {!p.spend && ' · 지출 불가'}
              {p.income && ' · 수입 가능'}
            </small>
          </div>
          <div className="list-right">
            <button className="link-btn" onClick={() => startEdit(p)}>수정</button>
            <button className="link-btn" onClick={() => remove(p)}>삭제</button>
          </div>
        </div>
      ))}
    </>
  );
}

// 카드사: 이용기간(시작·끝)과 결제일. 바뀔 수 있으니 여기서 언제든 고칩니다.
const BLANK_ISSUER = {
  name: '',
  noCycle: false,
  fromPrev: true,
  fromDay: '1',
  toPrev: true,
  toDay: '31',
  paymentDay: '',
};

const dayValue = (v) => {
  const d = Math.round(Number(v));
  return d >= 1 && d <= 31 ? d : null;
};

const cycleText = (c) => {
  if (!c) return '사용한 달 그대로 청구';
  const part = (x) => `${x.offset === -1 ? '전월' : '당월'} ${x.day === 31 ? '말일' : `${x.day}일`}`;
  return `이용기간 ${part(c.from)} ~ ${part(c.to)} · 결제일 ${c.paymentDay}일`;
};

function IssuerManager({ api, payApi }) {
  const [form, setForm] = useState(BLANK_ISSUER);
  const [editingId, setEditingId] = useState(null);
  const rows = [...api.rows].sort((a, b) => a.name.localeCompare(b.name));

  function reset() {
    setForm(BLANK_ISSUER);
    setEditingId(null);
  }

  function startEdit(i) {
    const c = i.cycle;
    setEditingId(i.id);
    setForm({
      name: i.name,
      noCycle: !c,
      fromPrev: (c?.from.offset ?? -1) === -1,
      fromDay: String(c?.from.day ?? 1),
      toPrev: (c?.to.offset ?? 0) === -1,
      toDay: String(c?.to.day ?? 31),
      paymentDay: String(c?.paymentDay ?? ''),
    });
  }

  async function save(e) {
    e.preventDefault();
    const name = form.name.trim();
    if (!name) return;
    if (isDuplicateName(api.rows, name, editingId)) {
      return window.alert(`"${name}" 카드사가 이미 있어요. 기존 항목을 수정해 주세요.`);
    }
    let cycle = null;
    if (!form.noCycle) {
      const fromDay = dayValue(form.fromDay);
      const toDay = dayValue(form.toDay);
      const paymentDay = dayValue(form.paymentDay);
      if (!fromDay || !toDay || !paymentDay) {
        return window.alert('이용기간 시작·끝과 결제일을 1~31 사이의 날짜로 입력해 주세요. (31은 말일)');
      }
      cycle = {
        from: { offset: form.fromPrev ? -1 : 0, day: fromDay },
        to: { offset: form.toPrev ? -1 : 0, day: toDay },
        paymentDay,
      };
    }
    const data = { name, cycle };
    if (editingId) await api.update(editingId, data);
    else await api.add(data);
    reset();
  }

  async function remove(i) {
    const used = payApi.rows.filter((p) => p.issuerId === i.id).length;
    if (used > 0) {
      return window.alert(`이 카드사를 쓰는 결제수단이 ${used}개 있어요. 결제수단에서 카드사를 먼저 바꿔 주세요.`);
    }
    if (!window.confirm(`"${i.name}" 카드사를 삭제할까요?`)) return;
    await api.remove(i.id);
    if (editingId === i.id) reset();
  }

  return (
    <>
      <form className="manage-form" onSubmit={save}>
        <input
          placeholder="카드사 이름 (예: 삼성, 하나)"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <label className="wide">
          <input
            type="checkbox"
            checked={form.noCycle}
            onChange={(e) => setForm({ ...form, noCycle: e.target.checked })}
          />{' '}
          사용한 달 그대로 청구 (이용기간·결제일 없음)
        </label>
        {!form.noCycle && (
          <>
            <div className="rule-block wide">
              <div className="rule-title">이용기간 시작</div>
              <div className="rule-row rule-row-one">
                <select value={form.fromPrev ? 'prev' : 'this'} onChange={(e) => setForm({ ...form, fromPrev: e.target.value === 'prev' })} aria-label="시작 달">
                  <option value="prev">전월</option>
                  <option value="this">당월</option>
                </select>
                <input type="number" min="1" max="31" placeholder="일" value={form.fromDay} onChange={(e) => setForm({ ...form, fromDay: e.target.value })} />
              </div>
              <div className="rule-title">이용기간 끝 <small className="muted">31 = 말일</small></div>
              <div className="rule-row rule-row-one">
                <select value={form.toPrev ? 'prev' : 'this'} onChange={(e) => setForm({ ...form, toPrev: e.target.value === 'prev' })} aria-label="끝 달">
                  <option value="prev">전월</option>
                  <option value="this">당월</option>
                </select>
                <input type="number" min="1" max="31" placeholder="일" value={form.toDay} onChange={(e) => setForm({ ...form, toDay: e.target.value })} />
              </div>
            </div>
            <input
              type="number"
              min="1"
              max="31"
              placeholder="결제일 (청구월의 몇 일)"
              value={form.paymentDay}
              onChange={(e) => setForm({ ...form, paymentDay: e.target.value })}
            />
          </>
        )}
        <span className="manage-form-buttons wide">
          {editingId && <button type="button" className="link-btn" onClick={reset}>취소</button>}
          <button className="btn-dark" type="submit">{editingId ? '저장' : '추가'}</button>
        </span>
      </form>

      {rows.length === 0 && <p className="muted">등록된 카드사가 없어요. 카드사를 추가하면 청구를 카드사별로 묶어 볼 수 있어요.</p>}
      {rows.map((i) => (
        <div className="manage-row" key={i.id}>
          <div className="grow">
            <b>{i.name}</b>{' '}
            <small className="muted">
              {cycleText(i.cycle)} · 결제수단 {payApi.rows.filter((p) => p.issuerId === i.id).length}개
            </small>
          </div>
          <div className="list-right">
            <button className="link-btn" onClick={() => startEdit(i)}>수정</button>
            <button className="link-btn" onClick={() => remove(i)}>삭제</button>
          </div>
        </div>
      ))}
    </>
  );
}

const BLANK_FIXED = {
  kind: 'expense', // expense(지출) | income(수입) | transfer(이동)
  name: '',
  amount: '',
  day: '',
  category: '',
  sub: '',
  paymentId: '',
  fromId: '',
  toId: '',
  memo: '',
  counts: true,
  deductible: true,
  personal: false,
  company: false,
};

export const FIXED_KIND_LABEL = { expense: '지출', income: '수입', transfer: '이동' };
const kindOf = (f) => f.kind ?? 'expense'; // 예전 항목은 종류가 없어서 지출로 봅니다.

// 고정 항목: 매달 같은 금액이 나가거나 들어오거나 옮겨지는 항목을 한 번만 입력합니다.
// 시작한 달부터 달마다 거래가 자동으로 만들어지고, 그 거래는 일반 거래와 똑같이 고칠 수 있습니다.
function FixedManager({ api, payApi, catApi }) {
  const [form, setForm] = useState(BLANK_FIXED);
  const [editingId, setEditingId] = useState(null);
  const payById = Object.fromEntries(payApi.rows.map((p) => [p.id, p]));
  const payOptions = sortByKind(payApi.rows);
  const accountOptions = accountsFor(payApi.rows);
  const isTransfer = form.kind === 'transfer';
  const catType = form.kind === 'income' ? 'income' : 'expense';
  const cats = catApi.rows.filter((c) => c.type === catType).sort(byOrder);
  const chosenCat = cats.find((c) => c.name === form.category);
  const rows = [...api.rows].sort(byOrder);
  const totalOf = (kind) =>
    rows
      .filter((f) => f.active !== false && kindOf(f) === kind)
      .reduce((s, f) => s + (Number(f.amount) || 0), 0);

  function reset() {
    setForm(BLANK_FIXED);
    setEditingId(null);
  }

  function setKind(kind) {
    setForm({ ...form, kind, category: '', sub: '', paymentId: '' });
  }

  function startEdit(f) {
    setEditingId(f.id);
    setForm({
      kind: kindOf(f),
      name: f.name,
      amount: String(f.amount),
      day: f.day ? String(f.day) : '',
      category: f.category ?? '',
      sub: f.sub ?? '',
      paymentId: f.paymentId ?? '',
      fromId: f.fromId ?? '',
      toId: f.toId ?? '',
      memo: f.memo ?? '',
      counts: f.counts !== false,
      deductible: f.deductible !== false,
      personal: !!f.personal,
      company: !!f.company,
    });
  }

  async function save(e) {
    e.preventDefault();
    const name = form.name.trim();
    const amount = Number(form.amount) || 0;
    if (!name || !(amount > 0)) return window.alert('내용과 금액을 입력해 주세요.');
    if (isTransfer) {
      if (!form.fromId || !form.toId || form.fromId === form.toId) {
        return window.alert('보내는 계좌와 받는 계좌를 서로 다르게 골라 주세요.');
      }
    } else if (!form.category) {
      return window.alert('대분류를 골라 주세요.');
    }
    const common = {
      kind: form.kind,
      name,
      amount,
      day: Math.min(31, Math.max(0, Number(form.day) || 0)), // 0이면 날짜 표시 없음
      memo: form.memo.trim(),
    };
    let data;
    if (isTransfer) {
      data = { ...common, fromId: form.fromId, toId: form.toId, paymentId: '', category: '', sub: '' };
    } else {
      data = {
        ...common,
        category: form.category,
        sub: form.sub,
        paymentId: form.paymentId,
        fromId: '',
        toId: '',
      };
      if (form.kind === 'expense') {
        Object.assign(data, { counts: form.counts, deductible: form.deductible, personal: form.personal, company: form.company });
      }
    }
    // 수정은 앞으로 만들어질 달부터 적용됩니다. 이미 만들어진 달의 거래는 그 거래에서 고칩니다.
    if (editingId) await api.update(editingId, data);
    else await api.add({ ...data, active: true, startMonth: thisMonth(), skipped: [], order: rows.length });
    reset();
  }

  async function toggle(f) {
    await api.update(f.id, { active: f.active === false });
  }

  async function remove(f) {
    if (!window.confirm(`"${f.name}" 고정 항목을 삭제할까요?`)) return;
    await api.remove(f.id);
    if (editingId === f.id) reset();
  }

  return (
    <>
      <form className="manage-form" onSubmit={save}>
        <div className="segmented wide">
          {Object.entries(FIXED_KIND_LABEL).map(([k, label]) => (
            <button type="button" key={k} className={form.kind === k ? 'active' : ''} onClick={() => setKind(k)}>
              {label}
            </button>
          ))}
        </div>
        <input
          placeholder={isTransfer ? '내용 (예: 공용비용 적립, 적금 이체)' : '이름 (예: 월세, 통신비, 월급)'}
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <MoneyInput
          placeholder="금액 (원)"
          value={form.amount}
          onChange={(v) => setForm({ ...form, amount: v })}
          aria-label="금액"
        />
        <input
          type="number"
          inputMode="numeric"
          placeholder="매달 날짜 (1~31, 선택)"
          value={form.day}
          onChange={(e) => setForm({ ...form, day: e.target.value })}
          aria-label="날짜"
        />
        {isTransfer ? (
          <>
            <select value={form.fromId} onChange={(e) => setForm({ ...form, fromId: e.target.value })} aria-label="보내는 계좌">
              <option value="">보내는 계좌 (From)</option>
              {accountOptions.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <select value={form.toId} onChange={(e) => setForm({ ...form, toId: e.target.value })} aria-label="받는 계좌">
              <option value="">받는 계좌 (To)</option>
              {accountOptions.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </>
        ) : (
          <>
            <select
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value, sub: '' })}
              aria-label="대분류"
            >
              <option value="">대분류 선택</option>
              {cats.map((c) => (
                <option key={c.id} value={c.name}>{c.name}</option>
              ))}
            </select>
            <select
              value={form.sub}
              onChange={(e) => setForm({ ...form, sub: e.target.value })}
              aria-label="소분류"
              disabled={!chosenCat || (chosenCat.subs ?? []).length === 0}
            >
              <option value="">소분류 (선택)</option>
              {(chosenCat?.subs ?? []).map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <select
              value={form.paymentId}
              onChange={(e) => setForm({ ...form, paymentId: e.target.value })}
              aria-label="결제수단"
            >
              <option value="">{form.kind === 'income' ? '입금 계좌 (선택)' : '결제수단 (선택)'}</option>
              {payOptions.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </>
        )}
        <input
          className="wide"
          placeholder="메모 (선택)"
          value={form.memo}
          onChange={(e) => setForm({ ...form, memo: e.target.value })}
        />
        <div className="manage-flags wide">
          {form.kind === 'expense' && (
            <>
              <label>
                <input type="checkbox" checked={form.counts} onChange={(e) => setForm({ ...form, counts: e.target.checked })} />
                실적 포함
              </label>
              <label>
                <input type="checkbox" checked={form.deductible} onChange={(e) => setForm({ ...form, deductible: e.target.checked })} />
                공제
              </label>
              <label>
                <input type="checkbox" checked={form.personal} onChange={(e) => setForm({ ...form, personal: e.target.checked })} />
                보연 개인
              </label>
              <label>
                <input type="checkbox" checked={form.company} onChange={(e) => setForm({ ...form, company: e.target.checked })} />
                회사 비용
              </label>
            </>
          )}
          <span className="manage-form-buttons">
            {editingId && <button type="button" className="link-btn" onClick={reset}>취소</button>}
            <button className="btn-dark" type="submit">{editingId ? '저장' : '추가'}</button>
          </span>
        </div>
      </form>

      <p className="muted" style={{ margin: '0 0 6px' }}>
        매달 지출 {formatWon(totalOf('expense'))} · 수입 {formatWon(totalOf('income'))} · 이동 {formatWon(totalOf('transfer'))}
        {' '}(사용 중인 항목 기준)
      </p>
      {rows.length === 0 && <p className="muted">등록된 고정 항목이 없어요.</p>}
      {rows.map((f) => {
        const k = kindOf(f);
        const detail =
          k === 'transfer'
            ? `${payById[f.fromId]?.name ?? '(삭제된 계좌)'} → ${payById[f.toId]?.name ?? '(삭제된 계좌)'}`
            : [f.category && `${f.category}${f.sub ? ` · ${f.sub}` : ''}`, payById[f.paymentId]?.name]
                .filter(Boolean)
                .join(' · ');
        return (
          <div className="manage-row" key={f.id} style={{ opacity: f.active === false ? 0.5 : 1 }}>
            <div className="grow">
              <b>{f.name}</b>{' '}
              <small className="muted">
                {FIXED_KIND_LABEL[k]} · {formatWon(f.amount)}
                {f.day ? ` · 매달 ${f.day}일` : ''}
                {detail ? ` · ${detail}` : ''}
                {f.memo ? ` · ${f.memo}` : ''}
                {f.active === false ? ' · 꺼짐' : ''}
              </small>
            </div>
            <div className="list-right">
              <button className="link-btn" onClick={() => toggle(f)}>{f.active === false ? '켜기' : '끄기'}</button>
              <button className="link-btn" onClick={() => startEdit(f)}>수정</button>
              <button className="link-btn" onClick={() => remove(f)}>삭제</button>
            </div>
          </div>
        );
      })}
    </>
  );
}

const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

// 카드별 달별 할인 한도. 한 카드·한 달에 한 줄만 둡니다.
// 통합 한도(limit)와 혜택별 한도(caps: { 혜택 key: 원 })를 그 달 값으로 직접 입력합니다.
function LimitManager({ api, payApi }) {
  const cards = payApi.rows.filter((p) => benefitsOf(p).length > 0 || limitsOf(p).length > 0).sort(byOrder);
  const cardById = Object.fromEntries(payApi.rows.map((p) => [p.id, p]));
  const blankFor = (pid, month = thisMonth()) => ({
    paymentId: pid,
    month,
    total: '',
    caps: Object.fromEntries(benefitsOf(cardById[pid]).map((b) => [b.key, ''])),
  });
  const [form, setForm] = useState(() => blankFor(cards[0]?.id ?? ''));
  const [editingId, setEditingId] = useState(null);
  const rows = [...api.rows].sort(
    (a, b) => b.month.localeCompare(a.month) || (cardById[a.paymentId]?.name ?? '').localeCompare(cardById[b.paymentId]?.name ?? ''),
  );
  const chosen = cardById[form.paymentId];
  const choices = limitsOf(chosen);
  const chosenBenefits = benefitsOf(chosen);

  function reset() {
    setForm(blankFor(form.paymentId, form.month));
    setEditingId(null);
  }

  function pickCard(pid) {
    setForm(blankFor(pid, form.month));
  }

  function startEdit(l) {
    setEditingId(l.id);
    setForm({
      paymentId: l.paymentId,
      month: l.month,
      total: String(l.limit),
      caps: Object.fromEntries(
        benefitsOf(cardById[l.paymentId]).map((b) => [b.key, l.caps?.[b.key] ? String(l.caps[b.key]) : '']),
      ),
    });
  }

  async function save(e) {
    e.preventDefault();
    const total = Number(form.total) || 0;
    if (!form.paymentId || !/^\d{4}-\d{2}$/.test(form.month) || !(total > 0)) {
      return window.alert('카드, 달, 통합 한도를 입력해 주세요.');
    }
    const caps = {};
    for (const b of chosenBenefits) {
      const v = Number(form.caps[b.key]) || 0;
      if (v > 0) caps[b.key] = v;
    }
    const dup = api.rows.find((l) => l.id !== editingId && l.paymentId === form.paymentId && l.month === form.month);
    if (dup) return window.alert('이 카드의 같은 달 한도가 이미 있어요. 그 줄을 수정해 주세요.');
    const data = { paymentId: form.paymentId, month: form.month, limit: total, caps };
    if (editingId) await api.update(editingId, data);
    else await api.add(data);
    reset();
  }

  async function remove(l) {
    const name = cardById[l.paymentId]?.name ?? '카드';
    if (!window.confirm(`${name} ${l.month} 할인 한도를 삭제할까요?`)) return;
    await api.remove(l.id);
    if (editingId === l.id) reset();
  }

  return (
    <>
      {cards.length === 0 ? (
        <p className="muted">할인 혜택 규칙이 있는 카드가 없어요. 지금은 하나 MG+ S만 지원해요.</p>
      ) : (
        <form className="manage-form" onSubmit={save}>
          <select value={form.paymentId} onChange={(e) => pickCard(e.target.value)} aria-label="카드">
            {cards.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <input
            type="month"
            value={form.month}
            onChange={(e) => setForm({ ...form, month: e.target.value })}
            aria-label="달"
          />
          <MoneyInput
            className="wide"
            placeholder={`이번 달 통합 한도 (원)${choices.length ? ` · 옵션 ${choices.join(' / ')}` : ''}`}
            value={form.total}
            onChange={(v) => setForm({ ...form, total: v })}
            aria-label="통합 한도"
          />
          {chosenBenefits.map((b) => (
            <MoneyInput
              key={b.key}
              placeholder={`${b.label} 분야 한도 (원)${b.limitOptions?.length ? ` · 옵션 ${b.limitOptions.join(' / ')}` : ''}`}
              value={form.caps[b.key] ?? ''}
              onChange={(v) => setForm({ ...form, caps: { ...form.caps, [b.key]: v } })}
              aria-label={`${b.label} 분야 한도`}
            />
          ))}
          <span className="manage-form-buttons wide">
            {editingId && <button type="button" className="link-btn" onClick={reset}>취소</button>}
            <button className="btn-dark" type="submit">{editingId ? '저장' : '추가'}</button>
          </span>
        </form>
      )}

      {rows.length === 0 && <p className="muted">등록된 할인 한도가 없어요.</p>}
      {rows.map((l) => (
        <div className="manage-row" key={l.id}>
          <div className="grow">
            <b>{cardById[l.paymentId]?.name ?? '삭제된 카드'}</b>{' '}
            <small className="muted">
              {l.month} · 통합 한도 {formatWon(l.limit)}
              {Object.keys(l.caps ?? {}).length > 0 &&
                ` · ${Object.entries(l.caps)
                  .map(([k, v]) => `${benefitsOf(cardById[l.paymentId]).find((b) => b.key === k)?.label ?? k} ${formatWon(v)}`)
                  .join(' · ')}`}
            </small>
          </div>
          <div className="list-right">
            <button className="link-btn" onClick={() => startEdit(l)}>수정</button>
            <button className="link-btn" onClick={() => remove(l)}>삭제</button>
          </div>
        </div>
      ))}
    </>
  );
}

function CategoryManager({ api }) {
  const [type, setType] = useState('expense');
  const [newName, setNewName] = useState('');
  const [subDrafts, setSubDrafts] = useState({});
  const [dragMajor, setDragMajor] = useState(null);
  const [dragSub, setDragSub] = useState(null); // { catId, sub }
  const list = api.rows.filter((c) => c.type === type).sort(byOrder);

  async function addMajor(e) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    if (isDuplicateName(list, name)) return window.alert(`"${name}" 대분류가 이미 있어요.`);
    await api.add({ type, name, subs: [], order: list.length });
    setNewName('');
  }

  async function removeMajor(c) {
    if (!window.confirm(`"${c.name}" 대분류와 소분류 ${c.subs.length}개를 삭제할까요?`)) return;
    await api.remove(c.id);
  }

  async function addSub(e, c) {
    e.preventDefault();
    const sub = (subDrafts[c.id] ?? '').trim();
    if (!sub) return;
    if (c.subs.some((s) => normName(s) === normName(sub))) return window.alert(`"${sub}" 소분류가 이미 있어요.`);
    await api.update(c.id, { subs: [...c.subs, sub] });
    setSubDrafts({ ...subDrafts, [c.id]: '' });
  }

  async function removeSub(c, sub) {
    if (!window.confirm(`소분류 "${sub}"을(를) 삭제할까요?`)) return;
    await api.update(c.id, { subs: c.subs.filter((s) => s !== sub) });
  }

  async function dropMajor(targetId) {
    const from = list.findIndex((c) => c.id === dragMajor);
    const to = list.findIndex((c) => c.id === targetId);
    setDragMajor(null);
    if (from < 0 || to < 0 || from === to) return;
    await saveOrder(api, moved(list, from, to));
  }

  // 소분류는 같은 대분류 안에서만 순서를 바꿉니다.
  async function dropSub(c, targetSub) {
    const drag = dragSub;
    setDragSub(null);
    if (!drag || drag.catId !== c.id || drag.sub === targetSub) return;
    const from = c.subs.indexOf(drag.sub);
    const to = c.subs.indexOf(targetSub);
    await api.update(c.id, { subs: moved(c.subs, from, to) });
  }

  return (
    <>
      <div className="segmented manage-tabs">
        {[
          ['expense', '지출'],
          ['income', '수입'],
        ].map(([t, label]) => (
          <button key={t} className={type === t ? 'active' : ''} onClick={() => setType(t)}>
            {label}
          </button>
        ))}
      </div>

      <form className="manage-form" onSubmit={addMajor}>
        <input
          className="wide"
          placeholder="새 대분류 이름"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <span className="manage-form-buttons wide">
          <button className="btn-dark" type="submit">대분류 추가</button>
        </span>
      </form>

      {list.length === 0 && <p className="muted">대분류가 없어요.</p>}
      {list.map((c) => (
        <div
          className={`manage-row manage-row-top ${dragMajor === c.id ? 'dragging' : ''}`}
          key={c.id}
          draggable
          onDragStart={() => setDragMajor(c.id)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => dropMajor(c.id)}
          onDragEnd={() => setDragMajor(null)}
        >
          <span className="grip" aria-hidden="true">⠿</span>
          <div className="grow">
            <b>{c.name}</b>
            <div className="sub-chips">
              {c.subs.map((s) => (
                <span
                  className={`sub-chip ${dragSub?.sub === s && dragSub?.catId === c.id ? 'dragging' : ''}`}
                  key={s}
                  draggable
                  onDragStart={(e) => {
                    e.stopPropagation();
                    setDragSub({ catId: c.id, sub: s });
                  }}
                  onDragOver={(e) => {
                    if (dragSub?.catId === c.id) e.preventDefault();
                  }}
                  onDrop={(e) => {
                    e.stopPropagation();
                    dropSub(c, s);
                  }}
                  onDragEnd={() => setDragSub(null)}
                >
                  {s}
                  <button type="button" aria-label={`${s} 삭제`} onClick={() => removeSub(c, s)}>×</button>
                </span>
              ))}
            </div>
            <form className="sub-add" onSubmit={(e) => addSub(e, c)}>
              <input
                placeholder="소분류 추가"
                value={subDrafts[c.id] ?? ''}
                onChange={(e) => setSubDrafts({ ...subDrafts, [c.id]: e.target.value })}
              />
              <button className="link-btn" type="submit">추가</button>
            </form>
          </div>
          <div className="list-right">
            <button className="link-btn" onClick={() => removeMajor(c)}>삭제</button>
          </div>
        </div>
      ))}
    </>
  );
}
