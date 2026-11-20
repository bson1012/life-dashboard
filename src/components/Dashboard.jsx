import { useCollection } from '../data/useCollection';
import { categoryColor } from '../utils/categoryColor';
import { PAGES } from '../config/pages';
import { summarize } from '../utils/ledger';
import { formatDateTime, formatWon, monthStr, toDateStr, todayStr } from '../utils/format';
import { MOODS, moodEmoji } from '../utils/mood';

// 파스텔 팔레트 (카테고리 순서대로 사용)
const MOOD_COLORS = { great: '#fde08a', good: '#bfe8d2', ok: '#c7d2fe', bad: '#dccbf5', awful: '#f4a7b9' };
const STATUS_META = [
  { v: 'todo', label: '진행 전', color: '#c7d2fe' },
  { v: 'doing', label: '진행 중', color: '#bfe6f5' },
  { v: 'hold', label: '보류', color: '#fde9a8' },
  { v: 'done', label: '완료', color: '#bfe8d2' },
];
const statusOf = (t) => t.status ?? (t.done ? 'done' : 'todo');

// 원 그래프: slices 는 { value, color } 배열입니다.
function Donut({ slices, center }) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  const r = 40;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg viewBox="0 0 100 100" className="donut" role="img" aria-label="원 그래프">
      <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="14" />
      {total > 0 &&
        slices.map((s, i) => {
          const len = (s.value / total) * c;
          const el = (
            <circle
              key={i}
              cx="50"
              cy="50"
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth="14"
              strokeDasharray={`${len} ${c - len}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 50 50)"
            />
          );
          offset += len;
          return el;
        })}
      {center && (
        <text x="50" y="54" textAnchor="middle" className="donut-center">{center}</text>
      )}
    </svg>
  );
}

function Legend({ items }) {
  return (
    <ul className="legend">
      {items.map((it) => (
        <li key={it.label}>
          <i className="legend-dot" style={{ background: it.color }} />
          <span className="legend-label">{it.emoji ? `${it.emoji} ` : ''}{it.label}</span>
          <b>{it.value}</b>
        </li>
      ))}
    </ul>
  );
}

export default function Dashboard({ onNavigate }) {
  const tx = useCollection('transactions');
  const todos = useCollection('todos');
  const journal = useCollection('journal');

  const month = monthStr();
  const today = todayStr();
  const now = Date.now();
  const hour = new Date().getHours();
  const greeting = hour < 12 ? '좋은 아침이에요' : hour < 18 ? '좋은 오후예요' : '좋은 저녁이에요';

  // 이번 달 지출과 카테고리별 금액
  const { expense, categories } = summarize(tx.rows, month);
  const catSlices = categories.map(([name, value], i) => ({
    label: name,
    value,
    color: categoryColor(name).bg, // 가계부와 같은 카테고리 색
  }));
  const catLegend = catSlices.slice(0, 5).map((s) => ({
    ...s,
    value: `${Math.round((s.value / expense) * 100)}%`,
  }));

  // 최근 7일 지출 막대
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const key = toDateStr(d);
    const amt = tx.rows
      .filter((r) => r.type === 'expense' && r.date === key)
      .reduce((s, r) => s + r.amount, 0);
    return { key, amt };
  });
  const maxDay = Math.max(...days.map((d) => d.amt), 1);

  // 할 일을 오늘(지난 것 포함) / 내일 / 이번 주(내일 다음 날부터 일요일까지)로 나눕니다.
  const tomorrow = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return toDateStr(d); })();
  const weekEnd = (() => {
    const d = new Date();
    const idx = (d.getDay() + 6) % 7; // 월요일=0
    d.setDate(d.getDate() + (6 - idx));
    return toDateStr(d);
  })();
  const upcoming = todos.rows
    .filter((t) => !t.done && t.dueAt)
    .map((t) => ({ ...t, date: t.dueAt.slice(0, 10) }))
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const todayTodos = upcoming.filter((t) => t.date <= today);
  const tomorrowTodos = upcoming.filter((t) => t.date === tomorrow);
  const weekTodos = upcoming.filter((t) => t.date > tomorrow && t.date <= weekEnd);
  const whenLabel = (date) => (date <= today ? '오늘' : date === tomorrow ? '내일' : '이번 주');

  // 할 일 현황 (상태별 개수)
  const statusSlices = STATUS_META.map((s) => ({
    label: s.label,
    value: todos.rows.filter((t) => statusOf(t) === s.v).length,
    color: s.color,
  }));
  const statusTotal = statusSlices.reduce((s, x) => s + x.value, 0);

  // 이번 달 기분 (일기에 기분을 고른 날만 집계)
  const monthEntries = journal.rows.filter((r) => r.date.startsWith(month) && r.mood);
  const moodSlices = MOODS.map((m) => ({
    label: m.label,
    emoji: m.emoji,
    value: monthEntries.filter((r) => r.mood === m.value).length,
    color: MOOD_COLORS[m.value],
  }));
  const moodTotal = moodSlices.reduce((s, x) => s + x.value, 0);

  const todayEntry = journal.rows.find((r) => r.date === today);

  return (
    <div className="home">
      <header className="home-head">
        <div>
          <h2>{PAGES.home.label}</h2>
          <p className="home-date">{greeting} · {today}</p>
        </div>
      </header>

      <div className="home-grid">
        <section className="glass tile clickable" onClick={() => onNavigate('ledger')}>
          <p className="tile-label">이번 달 지출</p>
          <b className="tile-value">{formatWon(expense)}</b>
          <div className="mini-bars">
            {days.map((d) => (
              <div key={d.key} title={`${d.key} ${formatWon(d.amt)}`}>
                <i style={{ height: `${Math.max(4, (d.amt / maxDay) * 100)}%` }} />
              </div>
            ))}
          </div>
          <small className="tile-foot">최근 7일 지출 · {categories[0] ? `가장 많은 곳 ${categories[0][0]}` : '지출 없음'}</small>
        </section>

        <section className="glass tile clickable" onClick={() => onNavigate('ledger')}>
          <p className="tile-label">이번 달 카테고리별 사용률</p>
          {catSlices.length === 0 ? (
            <small className="tile-foot">이번 달 지출 기록이 없어요.</small>
          ) : (
            <div className="chart-row">
              <Donut slices={catSlices} center="지출" />
              <Legend items={catLegend} />
            </div>
          )}
        </section>

        <section className="glass tile clickable" onClick={() => onNavigate('todos')}>
          <p className="tile-label">할 일</p>
          <div className="week-counts">
            <span>오늘 <b>{todayTodos.length}</b></span>
            <span>내일 <b>{tomorrowTodos.length}</b></span>
            <span>이번 주 <b>{weekTodos.length}</b></span>
          </div>
          {todayTodos.length + tomorrowTodos.length + weekTodos.length === 0 ? (
            <small className="tile-foot">가까운 마감 할 일이 없어요 🎉</small>
          ) : (
            <ul className="tile-list">
              {[...todayTodos, ...tomorrowTodos, ...weekTodos].slice(0, 4).map((t) => {
                const overdue = new Date(t.dueAt).getTime() < now;
                return (
                  <li key={t.id}>
                    <span>
                      <em className="when-tag">{whenLabel(t.date)}</em>
                      {t.title}
                    </span>
                    <small className={overdue ? 'overdue' : ''}>{formatDateTime(t.dueAt)}</small>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="glass tile clickable" onClick={() => onNavigate('todos')}>
          <p className="tile-label">할 일 현황</p>
          {statusTotal === 0 ? (
            <small className="tile-foot">아직 할 일이 없어요.</small>
          ) : (
            <div className="chart-row">
              <Donut slices={statusSlices} center={String(statusTotal)} />
              <Legend items={statusSlices} />
            </div>
          )}
        </section>

        <section className="glass tile clickable" onClick={() => onNavigate('journal')}>
          <p className="tile-label">오늘의 일기</p>
          {todayEntry ? (
            <>
              <div className="mood-big">{moodEmoji(todayEntry.mood) || '📝'}</div>
              <small className="tile-foot tile-text">{todayEntry.content.slice(0, 80) || '(내용 없음)'}</small>
            </>
          ) : (
            <>
              <div className="mood-big">✎</div>
              <small className="tile-foot">아직 작성하지 않았어요</small>
            </>
          )}
        </section>

        <section className="glass tile clickable" onClick={() => onNavigate('journal')}>
          <p className="tile-label">이번 달 기분</p>
          {moodTotal === 0 ? (
            <small className="tile-foot">이번 달 기분 기록이 없어요.</small>
          ) : (
            <div className="chart-row">
              <Donut slices={moodSlices} center={String(moodTotal)} />
              <Legend items={moodSlices.map((m) => ({ ...m, value: m.value }))} />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
