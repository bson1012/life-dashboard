import { useMemo } from 'react';
import { performanceFor, TIER_UNIT } from '../utils/performance';
import { KIND_LABEL, tierText } from '../config/payments';
import { formatWon } from '../utils/format';
import { benefitsOf, rateText } from '../config/cardBenefits';
import { benefitLeft, limitFor, recordFor, usedLimit } from '../utils/discount';
import './PerformancePanel.css';

const man = (won) => `${Math.round(won / TIER_UNIT)}만`;

// 한도 대비 사용량을 보여 주는 작은 막대. 한도를 넘으면 가득 찬 상태로 보입니다.
function LimitBar({ used, total }) {
  const ratio = total > 0 ? Math.min(used / total, 1) : 0;
  const over = used >= total;
  return (
    <div className="limit-bar" role="img" aria-label={`사용 ${formatWon(used)} / 한도 ${formatWon(total)}`}>
      <div
        className={`limit-bar-fill ${over ? 'over' : ''}`}
        style={{ width: `${Math.round(ratio * 100)}%` }}
      />
    </div>
  );
}

// 이번 달 결제수단별 실적 현황: 사용액, 달성 구간, 다음 구간까지 남은 금액.
// 혜택 규칙이 있는 카드는 이번 달 할인 한도와 분야별 사용·남은 한도도 보여줍니다.
export default function PerformancePanel({ rows, payments, month, limitRows = [], onOpenLimits }) {
  const items = useMemo(() => performanceFor(rows, payments, month), [rows, payments, month]);

  return (
    <div className="card">
      <div className="row-between" style={{ marginTop: 0 }}>
        <h3 style={{ margin: 0 }}>이번 달 실적</h3>
        {onOpenLimits && (
          <button type="button" className="chip" onClick={onOpenLimits}>
            실적·할인 한도 설정
          </button>
        )}
      </div>
      {items.length === 0 && <p className="muted">실적으로 잡힌 결제가 없어요.</p>}
      <div className="perf-list">
      {items.map((it) => {
        const { payment: p, spent, achieved, next, remaining, ratio, billed, discount } = it;
        const benefits = benefitsOf(p);
        const isBenefit = benefits.length > 0;
        const monthLimit = isBenefit ? limitFor(limitRows, p.id, month) : 0;
        const monthCaps = isBenefit ? (recordFor(limitRows, p.id, month)?.caps ?? {}) : {};
        const usedTotal = isBenefit ? usedLimit({ rows, month, paymentId: p.id }) : 0;
        return (
          <div className="perf-row" key={p.id}>
            <div className="perf-head">
              <div>
                <b>{p.name}</b>{' '}
                <small className="muted">{KIND_LABEL[p.kind]}{tierText(p.tiers) && ` · ${tierText(p.tiers)}`}</small>
              </div>
              <span className="perf-spent">{formatWon(spent)}</span>
            </div>
            {ratio !== null && (
              <div className="perf-bar">
                <div style={{ width: `${Math.round(ratio * 100)}%` }} />
              </div>
            )}
            <small className="perf-status perf-billing">
              청구 {formatWon(billed)}
              {discount !== 0 && ` · 할인 ${formatWon(discount)}`}
            </small>
            <small className="perf-status">
              {next
                ? `${man(next)} 구간까지 ${formatWon(remaining)} 남음${achieved ? ` · 현재 ${man(achieved)} 달성` : ''}`
                : ratio === null
                  ? '실적 구간 없음'
                  : `최고 구간 ${man(achieved)} 달성`}
            </small>
            {isBenefit && (
              <div className="perf-benefit">
                <small className="perf-status">
                  {monthLimit
                    ? `이번 달 혜택 한도 ${formatWon(monthLimit)} 중 ${formatWon(Math.max(monthLimit - usedTotal, 0))} 남음 · 사용 ${formatWon(usedTotal)}`
                    : '이번 달 혜택 한도를 아직 설정하지 않았어요'}
                </small>
                {monthLimit > 0 && <LimitBar used={usedTotal} total={monthLimit} />}
                {benefits.map((b) => {
                  const bUsed = usedLimit({ rows, month, paymentId: p.id, benefitKey: b.key });
                  const bCap = monthCaps[b.key] ?? null;
                  const left = benefitLeft({ rows, month, paymentId: p.id, cap: bCap, benefit: b });
                  return (
                    <div className="perf-sub-block" key={b.key}>
                      <small className="perf-status perf-sub">
                        {b.label} {rateText(b)} · 사용 {formatWon(bUsed)}
                        {left !== null && ` · 분야 한도 ${formatWon(bCap)} 중 ${formatWon(left)} 남음`}
                      </small>
                      {bCap > 0 && <LimitBar used={bUsed} total={bCap} />}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      </div>
    </div>
  );
}
