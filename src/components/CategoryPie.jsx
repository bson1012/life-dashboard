import { formatWon } from '../utils/format';
import { categoryColor } from '../utils/categoryColor';

// 카테고리별 지출 파이 차트. 외부 라이브러리 없이 SVG 로 그립니다.
// items: [[대분류 이름, 금액], ...] (금액은 0보다 커야 합니다)
// 색은 대분류 이름으로 정해서, 내역 목록의 카테고리명 색과 같습니다.
const R = 80;
const C = 90;

export default function CategoryPie({ items }) {
  const total = items.reduce((sum, [, amt]) => sum + amt, 0);
  if (total <= 0) return <p className="muted">이번 달 지출이 없어요.</p>;

  let start = -Math.PI / 2; // 12시 방향에서 시작
  const slices = items.map(([name, amt]) => {
    const frac = amt / total;
    const end = start + frac * 2 * Math.PI;
    const x1 = C + R * Math.cos(start);
    const y1 = C + R * Math.sin(start);
    const x2 = C + R * Math.cos(end);
    const y2 = C + R * Math.sin(end);
    const d = `M ${C} ${C} L ${x1} ${y1} A ${R} ${R} 0 ${frac > 0.5 ? 1 : 0} 1 ${x2} ${y2} Z`;
    start = end;
    return { name, amt, frac, color: categoryColor(name).bg, d };
  });

  return (
    <div className="pie-wrap">
      <svg viewBox={`0 0 ${C * 2} ${C * 2}`} className="pie" role="img" aria-label="카테고리별 지출 파이 차트">
        {slices.length === 1 ? (
          <circle cx={C} cy={C} r={R} fill={slices[0].color} />
        ) : (
          slices.map((s) => <path key={s.name} d={s.d} fill={s.color} />)
        )}
      </svg>
      <ul className="pie-legend">
        {slices.map((s) => (
          <li key={s.name}>
            <i style={{ background: s.color }} />
            <span>{s.name}</span>
            <b>{Math.round(s.frac * 100)}%</b>
            <small className="muted">{formatWon(s.amt)}</small>
          </li>
        ))}
      </ul>
    </div>
  );
}
