import { useEffect, useState } from 'react';
import { useCollection } from '../data/useCollection';
import { PAGES } from '../config/pages';
import { MOODS, moodEmoji } from '../utils/mood';
import { todayStr } from '../utils/format';

export default function Journal() {
  const { rows, ready, add, update, remove } = useCollection('journal');
  const [date, setDate] = useState(todayStr());
  const [mood, setMood] = useState('');
  const [content, setContent] = useState('');
  const [query, setQuery] = useState('');
  const [saved, setSaved] = useState(false);

  const entry = rows.find((r) => r.date === date);

  // 날짜를 바꾸거나 처음 로드될 때 해당 날짜의 기록을 편집기에 불러옵니다.
  useEffect(() => {
    setMood(entry?.mood ?? '');
    setContent(entry?.content ?? '');
    setSaved(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, ready]);

  async function save() {
    if (!content.trim() && !mood) return;
    const data = { date, mood, content: content.trim() };
    if (entry) await update(entry.id, data);
    else await add(data);
    setSaved(true);
  }

  async function handleDelete() {
    if (!entry || !window.confirm('이 날짜의 일기를 삭제할까요?')) return;
    await remove(entry.id);
    setMood('');
    setContent('');
  }

  const list = rows
    .filter((r) => !query || r.content.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="page">
      <div className="page-head">
        <h2>{PAGES.journal.label}</h2>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>

      <div className="grid-2 journal-grid">
        <div className="card">
          <h3>{date} 의 기록</h3>
          <div className="moods">
            {MOODS.map((m) => (
              <button
                key={m.value}
                type="button"
                title={m.label}
                className={`mood ${mood === m.value ? 'active' : ''}`}
                onClick={() => setMood(m.value)}
              >
                {m.emoji}
              </button>
            ))}
          </div>
          <textarea
            className="journal-text"
            placeholder="오늘 하루는 어땠나요?"
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              setSaved(false);
            }}
          />
          <div className="row-between">
            <small className="muted">{saved ? '저장되었습니다' : entry ? '수정 중' : '새 기록'}</small>
            <div className="btn-group">
              {entry && <button className="link-btn" onClick={handleDelete}>삭제</button>}
              <button className="btn-dark" onClick={save}>저장</button>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="row-between">
            <h3>지난 기록</h3>
            <input placeholder="검색" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          {!ready ? null : list.length === 0 ? (
            <p className="muted">아직 기록이 없어요.</p>
          ) : (
            <ul className="list">
              {list.map((r) => (
                <li key={r.id} className="clickable" onClick={() => setDate(r.date)}>
                  <span className="entry-mood">{moodEmoji(r.mood) || '📝'}</span>
                  <div className="list-main">
                    <div>{r.date}</div>
                    <small className="muted">{r.content.slice(0, 60) || '(내용 없음)'}</small>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
