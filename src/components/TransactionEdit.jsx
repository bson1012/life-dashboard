import { useState } from 'react';
import MoneyInput from './MoneyInput';
import { accountsFor, paymentsFor } from '../config/payments';
import { subsOf, treeNames } from '../config/ledgerCategories';
import { cancelledOf, cardDiscountOf, discountWon, isDeductible, supportOf } from '../utils/ledger';
import { isCounted, perfOf } from '../utils/performance';
import { formatWon } from '../utils/format';
import PaymentPicker from './PaymentPicker';
import AmountExtras from './AmountExtras';
import { benefitsOf, limitsOf } from '../config/cardBenefits';
import { benefitDiscount, benefitLeft, limitFor, recordFor, remainingLimit } from '../utils/discount';

const num = (v) => (v === '' || v == null ? 0 : Number(v));

const TYPE_LABEL = { expense: '지출', income: '수입', transfer: '이동' };
// 지출이 아닌 거래(수입·이동)에는 지출 전용 값과 계좌 값을 남기지 않습니다.
const CLEAR_EXPENSE = {
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
  fromId: '',
  toId: '',
};

// 기존 거래 수정 팝업. 지출·수입·이동 사이의 종류 변경도 여기서 합니다.
// 입력 순서와 항목은 거래 추가 폼과 같습니다. 이동은 금액·날짜·보내는/받는 계좌·내용만 입력합니다.
// 취소 거래는 원거래에 묶여 있어서 여기서 수정하지 않고, 삭제 후 다시 등록합니다.
export default function TransactionEdit({ row, rows, trees, payments, limitRows = [], onSetLimit, onSave, onClose }) {
  const [form, setForm] = useState(() => {
    const pay = payments.find((p) => p.id === row.paymentId);
    // 예전 거래는 discountMode 가 없으므로 원 금액 할인으로 취급합니다.
    const mode = row.discountMode ?? 'won';
    const value = mode === 'rate' ? row.discountValue : cardDiscountOf(row);
    return {
      type: row.type,
      date: row.date,
      merchant: row.merchant ?? '',
      memo: row.memo ?? '',
      category: row.category ?? '',
      sub: row.sub ?? '',
      paymentId: row.paymentId,
      fromId: row.fromId || row.paymentId || '',
      toId: row.toId ?? '',
      amount: String(row.amount),
      discountMode: mode,
      discountValue: value ? String(value) : '',
      support: String(supportOf(row) || ''),
      benefit: row.benefit ?? '',
      counts: isCounted(row, pay),
      deductible: isDeductible(row),
      personal: !!row.personal,
      company: !!row.company,
      receipt: !!row.receipt,
    };
  });

  const type = form.type;
  const isExpense = type === 'expense';
  const isTransfer = type === 'transfer';
  const accounts = accountsFor(payments);
  const tree = isTransfer ? [] : (trees[type] ?? []);
  const category = tree.some((m) => m.name === form.category) ? form.category : (tree[0]?.name ?? form.category);
  const subs = subsOf(tree, category);
  const choices = isTransfer ? [] : paymentsFor(payments, type);
  // 이동은 보내는 계좌(fromId)를 결제수단 자리에 씁니다.
  const paymentId = isTransfer
    ? (accounts.some((p) => p.id === form.fromId) ? form.fromId : (accounts[0]?.id ?? ''))
    : (choices.some((p) => p.id === form.paymentId) ? form.paymentId : (choices[0]?.id ?? ''));
  const toId = isTransfer ? form.toId : '';
  const selected = payments.find((p) => p.id === paymentId);

  const approvedN = num(form.amount);
  // 카드 혜택이 골라져 있으면 할인은 혜택 할인율 × 승인 금액을 이번 달 남은 한도 안에서 계산합니다.
  const benefits = benefitsOf(selected);
  const limits = limitsOf(selected);
  const formMonth = form.date.slice(0, 7);
  const monthLimit = selected ? limitFor(limitRows, paymentId, formMonth) : 0;
  const leftLimit = remainingLimit({ rows, month: formMonth, paymentId, limit: monthLimit, excludeId: row.id });
  const pickedBenefit = benefits.find((b) => b.key === form.benefit);
  const monthCaps = recordFor(limitRows, paymentId, formMonth)?.caps ?? {};
  const cap = pickedBenefit ? (monthCaps[pickedBenefit.key] ?? null) : null;
  const leftBenefit = pickedBenefit
    ? benefitLeft({ rows, month: formMonth, paymentId, cap, benefit: pickedBenefit, excludeId: row.id })
    : null;
  const autoDiscount =
    isExpense && pickedBenefit
      ? benefitDiscount({
          rows,
          month: formMonth,
          paymentId,
          limit: monthLimit,
          cap,
          benefit: pickedBenefit,
          amount: approvedN,
          excludeId: row.id,
        })
      : 0;
  const discountN = isExpense
    ? pickedBenefit
      ? autoDiscount
      : discountWon(approvedN, form.discountMode, num(form.discountValue))
    : 0;
  const supportN = isExpense ? num(form.support) : 0;
  const actualN = approvedN - discountN - supportN;
  const billedN = approvedN - discountN;

  // 원거래의 취소 금액은 지출에만 있습니다. 원래 지출인 거래만 취소 금액을 셉니다.
  const cancelled = row.type === 'expense' ? cancelledOf(rows, row.id) : 0;

  function changeType(t) {
    if (t === type) return;
    if (row.type === 'expense' && cancelled > 0 && t !== 'expense') {
      return window.alert(`취소된 금액(${formatWon(cancelled)})이 있는 지출은 다른 종류로 바꿀 수 없어요.`);
    }
    setForm({
      ...form,
      type: t,
      category: '',
      sub: '',
      // 이동으로 바꾸면 지금 결제수단을 보내는 계좌로, 사용처는 내용으로 옮깁니다.
      fromId: t === 'transfer' ? paymentId : form.fromId,
      paymentId: t === 'transfer' ? '' : paymentId,
      toId: t === 'transfer' ? form.toId : '',
      memo: t === 'transfer' && !form.memo ? form.merchant : form.memo,
    });
  }

  function save(e) {
    e.preventDefault();
    if (!(approvedN > 0)) return window.alert('금액을 입력해 주세요.');

    if (isTransfer) {
      if (!paymentId || !toId) return window.alert('보내는 계좌와 받는 계좌를 골라 주세요.');
      if (paymentId === toId) return window.alert('보내는 계좌와 받는 계좌가 같아요.');
      return onSave({
        ...CLEAR_EXPENSE,
        type: 'transfer',
        date: form.date,
        merchant: '',
        memo: form.memo.trim(),
        amount: approvedN,
        category: '',
        sub: '',
        fromId: paymentId,
        toId,
        paymentId,
      });
    }

    if (isExpense && form.discountMode === 'rate' && num(form.discountValue) > 100) {
      return window.alert('할인율은 100% 이하로 입력해 주세요.');
    }
    if (supportN < 0) return window.alert('지원 금액은 0 이상이어야 해요.');
    if (discountN + supportN > approvedN) {
      return window.alert('카드 할인과 지원 금액의 합이 승인 금액을 넘을 수 없어요.');
    }
    if (approvedN < cancelled) {
      return window.alert(`이미 취소된 금액(${formatWon(cancelled)})보다 작게 바꿀 수 없어요.`);
    }
    const sub = subs.includes(form.sub) ? form.sub : (subs[0] ?? '');
    const patch = {
      type,
      date: form.date,
      merchant: form.merchant.trim(),
      memo: form.memo.trim(),
      amount: approvedN,
      category,
      sub,
      paymentId,
      fromId: '',
      toId: '',
    };
    if (isExpense) {
      patch.cardDiscount = discountN;
      if (pickedBenefit && !monthLimit) return window.alert('이번 달 할인 한도를 먼저 골라 주세요.');
      patch.discountMode = pickedBenefit ? 'benefit' : form.discountMode;
      patch.discountValue = pickedBenefit ? pickedBenefit.rate : num(form.discountValue);
      patch.benefit = pickedBenefit?.key ?? '';
      patch.support = supportN;
      patch.deductible = form.deductible;
      patch.personal = form.personal;
      patch.company = form.company;
      patch.counts = form.counts;
      if (selected?.kind === 'cash') patch.receipt = form.receipt;
    } else {
      Object.assign(patch, CLEAR_EXPENSE, { fromId: '', toId: '' });
    }
    onSave(patch);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal card edit-modal" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <div className="row-between" style={{ marginTop: 0 }}>
          <h3 style={{ margin: 0 }}>{TYPE_LABEL[type]} 수정</h3>
          <button type="button" className="link-btn" onClick={onClose}>닫기</button>
        </div>

        <div className="segmented" style={{ marginTop: 12 }}>
          {Object.keys(TYPE_LABEL).map((t) => (
            <button type="button" key={t} className={type === t ? 'active' : ''} onClick={() => changeType(t)}>
              {TYPE_LABEL[t]}
            </button>
          ))}
        </div>

        {isTransfer ? (
          <div className="form-stack" style={{ marginTop: 14 }}>
            <div className="form-row cols-1">
              <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </div>
            <div className="form-row">
              <MoneyInput placeholder="이동 금액" value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} />
              <select value={paymentId} onChange={(e) => setForm({ ...form, fromId: e.target.value })} aria-label="보내는 계좌 (From)">
                {accounts.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className="form-row">
              <select value={toId} onChange={(e) => setForm({ ...form, toId: e.target.value })} aria-label="받는 계좌 (To)">
                <option value="">받는 계좌 고르기</option>
                {accounts.filter((p) => p.id !== paymentId).map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <input placeholder="내용 (선택)" value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} />
            </div>
          </div>
        ) : (
          <>
            <div className="form-stack" style={{ marginTop: 14 }}>
              <div className="form-row cols-1">
                <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
              </div>
              <div className="form-row">
                <MoneyInput
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
              <div className="form-row">
                <input placeholder="사용처" value={form.merchant} onChange={(e) => setForm({ ...form, merchant: e.target.value })} />
                <input placeholder="내용 (선택)" value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} />
              </div>
              <div className="form-row">
                <select
                  value={category}
                  onChange={(e) => setForm({ ...form, category: e.target.value, sub: '' })}
                  aria-label="대분류"
                >
                  {treeNames(tree).map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
                <select
                  value={subs.includes(form.sub) ? form.sub : (subs[0] ?? '')}
                  onChange={(e) => setForm({ ...form, sub: e.target.value })}
                  aria-label="소분류"
                  disabled={subs.length === 0}
                >
                  {subs.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </div>
            </div>

            {isExpense && approvedN > 0 && (
              <div className="form-summary">
                <span>실제 사용 <b>{formatWon(actualN)}</b></span>
                {discountN > 0 && <span>청구 <b>{formatWon(billedN)}</b></span>}
                {cancelled > 0 && <span className="muted">취소 {formatWon(cancelled)}</span>}
              </div>
            )}

            {isExpense && (
              <AmountExtras
                form={form}
                setForm={setForm}
                showDiscount
                showCounts={perfOf(selected)}
                showReceipt={selected?.kind === 'cash'}
                benefits={benefits}
                limits={limits}
                monthLimit={monthLimit}
                leftLimit={leftLimit}
                leftBenefit={leftBenefit}
                onLimit={(v) => onSetLimit?.(paymentId, formMonth, v)}
                autoDiscount={autoDiscount}
              />
            )}
          </>
        )}

        <div className="manage-form-buttons" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
          <button type="button" className="link-btn" onClick={onClose}>취소</button>
          <button className="btn-dark" type="submit">저장</button>
        </div>
      </form>
    </div>
  );
}
