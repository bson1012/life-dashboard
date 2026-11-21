import { rateText } from '../config/cardBenefits';
import { formatWon } from '../utils/format';
import MoneyInput from './MoneyInput';

// 거래의 혜택 분야를 선택하고, 할인 방식과 실제 할인값을 직접 입력합니다.
// 혜택을 선택하면 해당 혜택의 기본 할인율/금액이 입력값으로 채워집니다.
export default function AmountExtras({
  form,
  setForm,
  showDiscount,
  showCounts,
  showReceipt,
  benefits = [],
  monthLimit = 0,
  leftLimit = 0,
  leftBenefit = null,
  discountN = 0,
}) {
  const flags = [
    showCounts && { key: 'counts', label: '실적' },
    { key: 'deductible', label: '공제' },
    { key: 'personal', label: '보연 개인' },
    { key: 'company', label: '회사 비용' },
    showReceipt && { key: 'receipt', label: '영수증' },
  ].filter(Boolean);

  const isRate = form.discountMode === 'rate';
  const hasBenefits = benefits.length > 0;
  const picked = benefits.find((b) => b.key === form.benefit);

  function chooseBenefit(benefit) {
    if (!benefit) {
      setForm({ ...form, benefit: '' });
      return;
    }

    setForm({
      ...form,
      benefit: benefit.key,
      discountMode: benefit.unit === 'won' ? 'won' : 'rate',
      discountValue: String(benefit.rate ?? ''),
    });
  }

  return (
    <div className="extras">
      {hasBenefits && monthLimit > 0 && (
        <span className="extras-note">
          이번 달 한도 {formatWon(monthLimit)} 중 <b>{formatWon(leftLimit)}</b> 남음
        </span>
      )}

      {hasBenefits && (
        <>
          <span className="extras-label">혜택 분야</span>
          <button
            type="button"
            className={`flag-chip ${!picked ? 'on' : ''}`}
            onClick={() => chooseBenefit(null)}
          >
            없음
          </button>
          {benefits.map((b) => (
            <button
              type="button"
              key={b.key}
              className={`flag-chip ${picked?.key === b.key ? 'on' : ''}`}
              title={b.examples}
              onClick={() => chooseBenefit(b)}
            >
              {b.label} {rateText(b)}
            </button>
          ))}
        </>
      )}

      {showDiscount && (
        <>
          <div className="mini-seg" role="group" aria-label="할인 방식">
            {[
              ['rate', '%'],
              ['won', '원'],
            ].map(([m, label]) => (
              <button
                type="button"
                key={m}
                className={form.discountMode === m ? 'active' : ''}
                onClick={() => setForm({ ...form, discountMode: m, discountValue: '' })}
              >
                {label}
              </button>
            ))}
          </div>

          <MoneyInput
            className="extra-input"
            placeholder={isRate ? '실제 할인율 (%)' : '실제 할인 금액 (원)'}
            value={form.discountValue}
            onChange={(v) => setForm({ ...form, discountValue: v })}
          />
        </>
      )}

      {picked && (
        <span className="extras-note">
          {monthLimit
            ? `적용 할인 ${formatWon(discountN)}${leftBenefit === null ? '' : ` · ${picked.label} 남은 한도 ${formatWon(leftBenefit)}`}`
            : '이번 달 할인 한도가 아직 없어요 (관리 > 할인 한도에서 설정)'}
        </span>
      )}

      {showDiscount && (
        <MoneyInput
          className="extra-input"
          placeholder="지원 금액"
          value={form.support}
          onChange={(v) => setForm({ ...form, support: v })}
        />
      )}

      {flags.map((f) => (
        <button
          type="button"
          key={f.key}
          className={`flag-chip ${form[f.key] ? 'on' : ''}`}
          onClick={() => setForm({ ...form, [f.key]: !form[f.key] })}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}
