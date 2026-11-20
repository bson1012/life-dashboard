import { useState } from 'react';
import { useCollection } from '../data/useCollection';
import DataManager from './DataManager';
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

// 이번 달 카테고리별 사용률 (rows 를 공용/보연 개인으로 나눠서 넘깁니다)
function CategoryTile({ title, rows, month, onClick }) {
  const { expense, categories } = summarize(rows, month);
  const slices = categories.map(([name, value]) => ({
    label: name,
    value,
    color: categoryColor(name).bg, // 가계부와 같은 카테고리 색
  }));
  const legend = slices.slice(0, 5).map((s) => ({
    ...s,
    value: expense ? `${Math.round((s.value / expense) * 100)}%` : '0%',
  }));
  return (
    <section className="glass tile clickable" onClick={onClick}>
      <p className="tile-label">{title}</p>
      {slices.length === 0 ? (
        <small className="tile-foot">이번 달 지출 기록이 없어요.</small>
      ) : (
        <div className="chart-row">
          <Donut slices={slices} center="지출" />
          <Legend items={legend} />
        </div>
      )}
    </section>
  );
}

export default function Dashboard({ onNavigate }) {
  const [dataOpen, setDataOpen] = useState(false);
  const tx = useCollection('transactions');
  const todos = useCollection('todos');
  const journal = useCollection('journal');
  const lists = useCollection('lists');
  const listItems = useCollection('listItems');

  const month = monthStr();
  const today = todayStr();
  const now = Date.now();
  const hour = new Date().getHours();
  const greeting = hour < 12 ? '좋은 아침이에요' : hour < 18 ? '좋은 오후예요' : '좋은 저녁이에요';

  // 이번 달 지출 합계
  const { expense, categories } = summarize(tx.rows, month);

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

  // 할 일 리스트: 아직 안 끝난 할 일 전부(마감 있는 것 먼저, 마감 순). 칸 안에서 스크롤됩니다.
  const openTodos = todos.rows
    .filter((t) => !t.done)
    .sort((a, b) => (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999'));

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
        <button
          onClick={() => setDataOpen(true)}
          className="home-manage-btn"
        >
          관리
        </button>
      </header>

      <div className="home-columns">
        {/* 첫 번째 칸: 지출 / 카테고리 사용률 */}
        <div className="home-col">
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

          <CategoryTile
            title="이번 달 카테고리별 사용률 (공용)"
            rows={tx.rows.filter((r) => !r.personal)}
            month={month}
            onClick={() => onNavigate('ledger')}
          />
          <CategoryTile
            title="이번 달 카테고리별 사용률 (보연 개인)"
            rows={tx.rows.filter((r) => r.personal)}
            month={month}
            onClick={() => onNavigate('ledger')}
          />
        </div>

        {/* 두 번째 칸: 할 일 */}
        <div className="home-col">
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

          <section className="glass tile clickable" onClick={() => onNavigate('todos')}>
            <p className="tile-label">할 일 리스트</p>
            <div className="week-counts">
              <span>오늘 <b>{todayTodos.length}</b></span>
              <span>내일 <b>{tomorrowTodos.length}</b></span>
              <span>이번 주 <b>{weekTodos.length}</b></span>
            </div>
            {openTodos.length === 0 ? (
              <small className="tile-foot">남은 할 일이 없어요 🎉</small>
            ) : (
              <ul className="tile-list todo-scroll">
                {openTodos.map((t) => {
                  const date = t.dueAt?.slice(0, 10);
                  const overdue = t.dueAt && new Date(t.dueAt).getTime() < now;
                  return (
                    <li key={t.id}>
                      <span>
                        {date && <em className="when-tag">{whenLabel(date)}</em>}
                        {t.title}
                      </span>
                      {t.dueAt && <small className={overdue ? 'overdue' : ''}>{formatDateTime(t.dueAt)}</small>}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        {/* 세 번째 칸: 일기 / 기분 */}
        <div className="home-col">
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

          <section className="glass tile clickable" onClick={() => onNavigate('lists')}>
            <p className="tile-label">리스트</p>
            {lists.rows.length === 0 ? (
              <small className="tile-foot">아직 리스트가 없어요.</small>
            ) : (
              <ul className="tile-list">
                {lists.rows.slice(0, 4).map((l) => {
                  const left = listItems.rows.filter((i) => i.listId === l.id && !i.done).length;
                  return (
                    <li key={l.id}>
                      <span>{l.name}</span>
                      <small>남은 {left}개</small>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>

      {/* 휴대폰: 관리 버튼은 맨 아래 */}
      <div className="home-manage-bottom">
        <button onClick={() => setDataOpen(true)} className="home-manage-btn">관리</button>
      </div>

      {dataOpen && <DataManager onClose={() => setDataOpen(false)} />}
    </div>
  );
}
