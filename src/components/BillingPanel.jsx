// 청구 예정: 다음 달에 카드사별로 합산되어 청구될 금액 (청구월 기준).
// 선택한 달의 다음 달을 보여 줍니다. 실적(사용한 달 기준)과는 따로 계산합니다.
import { useMemo } from 'react';
import { addMonths, billingFor, paymentDateOf } from '../utils/billing';
import { formatWon } from '../utils/format';

export default function BillingPanel({ rows, payments, issuers, month }) {
  const billMonth = addMonths(month, 1);
  const { groups } = useMemo(
    () => billingFor(rows, payments, issuers, billMonth),
    [rows, payments, issuers, billMonth],
  );
  const total = groups.reduce((s, g) => s + g.total, 0);

  return (
    <div className="card billing-panel">
      <div className="row-between" style={{ marginTop: 0 }}>
        <h3 style={{ margin: 0 }}>{Number(billMonth.slice(5))}월 청구 예정</h3>
        <b>{formatWon(total)}</b>
      </div>
      {groups.length === 0 && <p className="muted">다음 달에 청구될 내역이 없어요.</p>}
      {groups.map((g) => (
        <div key={g.key} className="billing-group">
          <div className="row-between">
            <b>{g.name}</b>
            <span>
              {g.issuer?.cycle && (
                <small className="muted">결제일 {paymentDateOf(billMonth, g.issuer).slice(5).replace('-', '/')} · </small>
              )}
              <b>{formatWon(g.total)}</b>
            </span>
          </div>
          {g.lines.length > 1 && (
            <ul className="billing-lines">
              {g.lines.map((l) => (
                <li key={l.paymentId}>
                  <span>{l.name}</span>
                  <span>{formatWon(l.billed)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
