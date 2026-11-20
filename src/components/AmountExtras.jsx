import { formatWon } from '../utils/format';
import MoneyInput from './MoneyInput';
import { rateText } from '../config/cardBenefits';

// 부가 정보 한 줄: 카드사 할인, 지원 금액, 그리고 실적·공제·보연 개인·영수증 플래그.
// 주 입력(날짜, 사용처, 분류, 수단, 승인 금액)보다 작고 옅게 보여줍니다.
// form 에는 discountMode, discountValue, support, benefit, counts, deductible, personal, receipt 키가 있어야 합니다.
// 카드에 혜택 규칙이 있으면(benefits) 할인 방식 대신 혜택 구분과 이번 달 한도를 고릅니다.
//   benefits: [{ key, label, rate }], monthLimit: 관리 > 할인 한도에서 설정한 이번 달 통합 한도(원),
//   autoDiscount: 혜택으로 계산된 할인(원)
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
  autoDiscount = 0,
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

  return (
    <div className="extras">
      {hasBenefits && monthLimit > 0 && (
        <span className="extras-note">
          이번 달 한도 {formatWon(monthLimit)} 중 <b>{formatWon(leftLimit)}</b> 남음
        </span>
      )}
      {hasBenefits && (
        <>
          <span className="extras-label">혜택</span>
          <button
            type="button"
            className={`flag-chip ${!picked ? 'on' : ''}`}
            onClick={() => setForm({ ...form, benefit: '' })}
          >
            없음
          </button>
          {benefits.map((b) => (
            <button
              type="button"
              key={b.key}
              className={`flag-chip ${picked?.key === b.key ? 'on' : ''}`}
              title={b.examples}
              onClick={() => setForm({ ...form, benefit: b.key })}
            >
              {b.label} {rateText(b)}
            </button>
          ))}
        </>
      )}
      {picked && (
        <span className="extras-note">
          {monthLimit
            ? `자동 할인 ${formatWon(autoDiscount)}${leftBenefit === null ? '' : ` · ${picked.label} 남은 한도 ${formatWon(leftBenefit)}`}`
            : '이번 달 할인 한도가 아직 없어요 (관리 > 할인 한도에서 설정)'}
        </span>
      )}
      {showDiscount && !picked && (
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
            placeholder={isRate ? '카드 할인율 (%)' : '카드 할인 (원)'}
            value={form.discountValue}
            onChange={(v) => setForm({ ...form, discountValue: v })}
          />
        </>
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
