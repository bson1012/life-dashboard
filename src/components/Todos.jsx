import { useEffect, useMemo, useState } from 'react';
import { useCollection } from '../data/useCollection';
import { PAGES } from '../config/pages';
import { formatDateTime, shiftDateTime, toDateStr, toDateTimeStr } from '../utils/format';

const REPEAT_LABEL = { none: '반복 없음', daily: '매일', weekly: '매주' };

// 마감/알림 빠른 입력: 오늘 기준으로 날짜를 넣고 시간은 오전 9시로 맞춥니다.
const QUICK_DATES = [
  { label: '1일 후', days: 1 },
  { label: '3일 후', days: 3 },
  { label: '1주일 후', days: 7 },
  { label: '2주 후', days: 14 },
  { label: '1달 후', months: 1 },
];
function quickValue(q) {
  const d = new Date();
  if (q.months) d.setMonth(d.getMonth() + q.months);
  else d.setDate(d.getDate() + q.days);
  d.setHours(9, 0, 0, 0);
  return toDateTimeStr(d);
}

// 빠른 날짜 버튼: 한 줄에 바로 누를 수 있게 보여줍니다.
function QuickButtons({ onPick }) {
  return (
    <span className="quick-buttons">
      {QUICK_DATES.map((q) => (
        <button key={q.label} type="button" className="chip quick" onClick={() => onPick(quickValue(q))}>
          {q.label}
        </button>
      ))}
      <button type="button" className="chip quick" onClick={() => onPick('')}>없음</button>
    </span>
  );
}

const PRIORITY = [
  { v: 'high', label: '높음', color: '#f4a7b9' },
  { v: 'mid', label: '보통', color: '#fde08a' },
  { v: 'low', label: '낮음', color: '#cfd4dc' },
];
const PRIORITY_RANK = Object.fromEntries(PRIORITY.map((p, i) => [p.v, i]));
const PRIORITY_COLOR = Object.fromEntries(PRIORITY.map((p) => [p.v, p.color]));
const PRIORITY_LABEL = Object.fromEntries(PRIORITY.map((p) => [p.v, p.label]));
// 기존 데이터(중요도 없음)는 보통으로 읽습니다.
const prioOf = (t) => t.priority ?? 'mid';

// 카테고리 색: bg는 띠/점/배경, fg는 글자색입니다. 모두 파스텔 톤입니다.
const CAT_BY_NAME = {
  boyeon: { bg: '#f7c5d5', fg: '#a13c60' }, // 핑크
  dohyun: { bg: '#bfe8d2', fg: '#2c7a55' }, // 그린
};
// 그 밖의 카테고리는 이름에 맞는 색이 없으면 순서대로 받습니다.
const CAT_PALETTE = [
  { bg: '#c7d2fe', fg: '#4150a8' }, // 블루
  { bg: '#fde9a8', fg: '#8a6400' }, // 옐로
  { bg: '#dccbf5', fg: '#6b43a8' }, // 퍼플
  { bg: '#fcd5b5', fg: '#9a5418' }, // 오렌지
  { bg: '#bfe6f5', fg: '#22708a' }, // 스카이
  { bg: '#dfe3ea', fg: '#4b5563' }, // 그레이
];
function catStyleOf(name, idx) {
  return CAT_BY_NAME[name.trim().toLowerCase()] ?? CAT_PALETTE[idx % CAT_PALETTE.length];
}

const emptyForm = { title: '', categoryId: '', priority: 'mid', dueAt: '', remindAt: '', repeat: 'none' };

const STATUS = [
  { v: 'todo', label: '진행 전' },
  { v: 'doing', label: '진행 중' },
  { v: 'hold', label: '보류' },
  { v: 'done', label: '완료' },
];
const STATUS_LABEL = Object.fromEntries(STATUS.map((s) => [s.v, s.label]));
// 기존 데이터(done만 있음)도 상태로 읽을 수 있게 합니다.
const statusOf = (t) => t.status ?? (t.done ? 'done' : 'todo');

const STATUS_FILTERS = [
  { v: 'all', label: '전체' },
  { v: 'open', label: '미완료' },
  { v: 'todo', label: '진행 전' },
  { v: 'doing', label: '진행 중' },
  { v: 'hold', label: '보류' },
  { v: 'done', label: '완료' },
];
const DUE_FILTERS = [
  { v: 'all', label: '전체 기간' },
  { v: 'overdue', label: '지남' },
  { v: 'soon', label: '오늘·내일' },
  { v: 'week', label: '이번 주' },
];

export default function Todos() {
  const todosApi = useCollection('todos');
  const catApi = useCollection('reminderCategories');
  const { rows, ready, add, update, remove } = todosApi;

  const [form, setForm] = useState(emptyForm);
  // 휴대폰 폭(760px 이하)이면 목록, 큰 화면이면 보드가 기본입니다. 폭이 바뀌면 그에 맞춰 바뀝니다.
  const [isPhone, setIsPhone] = useState(() => window.matchMedia('(max-width: 760px)').matches);
  const [view, setView] = useState(() => (isPhone ? 'list' : 'board')); // board | list
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 760px)');
    const onChange = (e) => {
      setIsPhone(e.matches);
      setView(e.matches ? 'list' : 'board');
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  const [statusFilter, setStatusFilter] = useState('all');
  const [dueFilter, setDueFilter] = useState('all');
  const [prioFilter, setPrioFilter] = useState('all');
  const [catFilter, setCatFilter] = useState('all');
  const [filtersOpen, setFiltersOpen] = useState(false); // 휴대폰에서 필터 줄 접기/펼치기
  // 전체가 아닌 필터 개수 (접혀 있을 때 머리줄에 보여 줍니다)
  const activeFilterCount = [statusFilter, dueFilter, prioFilter, catFilter].filter((v) => v !== 'all').length;
  const [newCat, setNewCat] = useState('');
  const [dragTaskId, setDragTaskId] = useState(null);
  const now = Date.now();

  // 날짜 기준값 (YYYY-MM-DD 문자열로 비교)
  const today = toDateStr(new Date());
  const tomorrow = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return toDateStr(d); })();
  const endOfWeek = (() => {
    const d = new Date();
    const idx = (d.getDay() + 6) % 7; // 월요일=0
    d.setDate(d.getDate() + (6 - idx)); // 이번 주 일요일
    return toDateStr(d);
  })();

  const cats = useMemo(
    () => [...catApi.rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [catApi.rows],
  );
  const catName = (id) => cats.find((c) => c.id === id)?.name ?? '';
  const catStyle = (id) => {
    const i = cats.findIndex((c) => c.id === id);
    if (i < 0) return null;
    return catStyleOf(cats[i].name, i);
  };
  const [catOpen, setCatOpen] = useState(false);
  const [editing, setEditing] = useState(null); // 수정 중인 할 일의 임시 값

  // 미완료 먼저, 그 안에서 중요도 높은 순, 같은 중요도는 마감일 빠른 순
  const sorted = useMemo(
    () =>
      [...rows].sort(
        (a, b) =>
          (statusOf(a) === 'done') - (statusOf(b) === 'done') ||
          PRIORITY_RANK[prioOf(a)] - PRIORITY_RANK[prioOf(b)] ||
          (a.dueAt || '~').localeCompare(b.dueAt || '~'),
      ),
    [rows],
  );

  const matchStatus = (t) => {
    const s = statusOf(t);
    if (statusFilter === 'all') return true;
    if (statusFilter === 'open') return s !== 'done';
    return s === statusFilter;
  };
  const matchDue = (t) => {
    if (dueFilter === 'all') return true;
    if (!t.dueAt) return false;
    const date = t.dueAt.slice(0, 10);
    if (dueFilter === 'overdue') return date < today;
    if (dueFilter === 'soon') return date >= today && date <= tomorrow;
    if (dueFilter === 'week') return date >= today && date <= endOfWeek;
    return true;
  };
  const matchPrio = (t) => prioFilter === 'all' || prioOf(t) === prioFilter;
  // 카테고리·기간·중요도 필터는 목록과 보드 모두에 적용합니다.
  const base = sorted.filter(
    (t) => matchDue(t) && matchPrio(t) && (catFilter === 'all' || t.categoryId === catFilter),
  );
  const visible = base.filter(matchStatus);
  // 현황 필터는 보드에서 보일 열을 정합니다. 미완료는 완료 열만 숨깁니다.
  const columnShown = (v) => {
    if (statusFilter === 'all') return true;
    if (statusFilter === 'open') return v !== 'done';
    return v === statusFilter;
  };
  const columns = STATUS.filter((s) => columnShown(s.v)).map((s) => ({
    ...s,
    items: base.filter((t) => statusOf(t) === s.v),
  }));

  // 마감 뱃지: 완료된 할 일과 마감일이 없는 할 일은 표시하지 않습니다.
  function dueBadge(t) {
    if (!t.dueAt || statusOf(t) === 'done') return null;
    const date = t.dueAt.slice(0, 10);
    if (date < today) return { text: '지남', cls: 'badge-overdue' };
    if (date === today) return { text: '오늘', cls: 'badge-today' };
    if (date === tomorrow) return { text: '내일', cls: 'badge-soon' };
    if (date <= endOfWeek) return { text: '이번 주', cls: 'badge-week' };
    return null;
  }

  const countFor = (id) => rows.filter((t) => statusOf(t) !== 'done' && t.categoryId === id).length;

  async function addCategory(e) {
    e.preventDefault();
    const name = newCat.trim();
    if (!name) return;
    const created = await catApi.add({ name });
    setNewCat('');
    setCatFilter(created.id);
    setForm((f) => ({ ...f, categoryId: created.id }));
  }

  async function deleteCategory(c) {
    if (!window.confirm(`"${c.name}" 카테고리를 삭제할까요? 할 일은 카테고리 없음으로 바뀝니다.`)) return;
    for (const t of rows.filter((t) => t.categoryId === c.id)) {
      await update(t.id, { categoryId: '' });
    }
    await catApi.remove(c.id);
    if (catFilter === c.id) setCatFilter('all');
    setForm((f) => (f.categoryId === c.id ? { ...f, categoryId: '' } : f));
  }

  async function submit(e) {
    e.preventDefault();
    if (!form.title.trim()) return;
    await add({
      title: form.title.trim(),
      categoryId: form.categoryId,
      priority: form.priority,
      status: 'todo',
      done: false,
      dueAt: form.dueAt,
      remindAt: '',
      repeat: form.dueAt ? form.repeat : 'none',
      notifiedFor: '',
    });
    // 카테고리와 중요도는 연속 입력을 위해 유지합니다.
    setForm({ ...emptyForm, categoryId: form.categoryId, priority: form.priority });
  }

  async function setStatus(t, status) {
    await update(t.id, { status, done: status === 'done' });
  }

  // 보드에서 카드를 다른 열로 끌어 놓으면 상태가 바뀝니다.
  function dropTo(status) {
    const t = rows.find((r) => r.id === dragTaskId);
    setDragTaskId(null);
    if (t && statusOf(t) !== status) setStatus(t, status);
  }

  async function removeTodo(t) {
    if (!window.confirm(`"${t.title}" 할 일을 삭제할까요?`)) return;
    await remove(t.id);
  }

  // 보드 열의 할 일을 한꺼번에 삭제합니다. 삭제 전에 개수를 확인받습니다.
  async function clearColumn(col) {
    if (col.items.length === 0) return;
    if (!window.confirm(`"${col.label}" 열의 할 일 ${col.items.length}개를 모두 삭제할까요?`)) return;
    for (const t of col.items) await remove(t.id);
  }

  function openEdit(t) {
    setEditing({
      id: t.id,
      title: t.title,
      categoryId: t.categoryId ?? '',
      priority: prioOf(t),
      dueAt: t.dueAt ?? '',
      repeat: t.repeat ?? 'none',
    });
  }

  async function saveEdit() {
    if (!editing || !editing.title.trim()) return;
    await update(editing.id, {
      title: editing.title.trim(),
      categoryId: editing.categoryId,
      priority: editing.priority,
      dueAt: editing.dueAt,
      repeat: editing.dueAt ? editing.repeat : 'none',
      notifiedFor: '',
    });
    setEditing(null);
  }

  // 체크박스: 완료 ↔ 진행 전. 반복 할 일은 완료 시 다음 회차로 넘기고 진행 전으로 돌립니다.
  async function toggle(t) {
    const isDone = statusOf(t) === 'done';
    if (!isDone && t.repeat !== 'none' && t.dueAt) {
      await update(t.id, {
        dueAt: shiftDateTime(t.dueAt, t.repeat),
        remindAt: t.remindAt ? shiftDateTime(t.remindAt, t.repeat) : '',
        status: 'todo',
        done: false,
        notifiedFor: '',
      });
      return;
    }
    await update(t.id, { status: isDone ? 'todo' : 'done', done: !isDone, notifiedFor: '' });
  }

  const catTag = (id) => {
    const s = catStyle(id);
    return s ? { background: s.bg, color: s.fg } : undefined;
  };

  // 보드 카드
  function renderCard(t) {
    const s = statusOf(t);
    const isDone = s === 'done';
    const overdue = !isDone && t.dueAt && new Date(t.dueAt).getTime() < now;
    const badge = dueBadge(t);
    const p = prioOf(t);
    return (
      <div
        key={t.id}
        className={`board-card ${dragTaskId === t.id ? 'dragging' : ''}`}
        draggable
        style={{ '--cat': catStyle(t.categoryId)?.bg ?? '#e5e7ee' }}
        onDragStart={() => setDragTaskId(t.id)}
        onDragEnd={() => setDragTaskId(null)}
      >
        <div className="board-card-top">
          <span className="prio-dot" style={{ background: PRIORITY_COLOR[p] }} title={`중요도 ${PRIORITY_LABEL[p]}`} />
          {catName(t.categoryId) && (
            <span className="tag" style={catTag(t.categoryId)}>{catName(t.categoryId)}</span>
          )}
          {badge && <span className={`due-badge ${badge.cls}`}>{badge.text}</span>}
        </div>
        <div className={isDone ? 'done-text' : ''}>{t.title}</div>
        <small className={overdue ? 'overdue' : 'muted'}>
          {t.dueAt && `마감 ${formatDateTime(t.dueAt)}`}
          {t.repeat !== 'none' && ` · ${REPEAT_LABEL[t.repeat]}`}
        </small>
        <div className="board-card-foot">
          <button className="check-btn" onClick={() => toggle(t)}>{isDone ? '완료 취소' : '완료'}</button>
          <span className="card-actions">
            <button className="link-btn" onClick={() => openEdit(t)}>수정</button>
            <button className="link-btn" onClick={() => removeTodo(t)}>삭제</button>
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className={`page ${view === 'board' ? 'page-fit' : ''}`}>
      <div className="page-head">
        <h2>{PAGES.todos.label}</h2>
      </div>

      {editing && (
        <div className="modal-backdrop" onClick={() => setEditing(null)}>
          <div className="modal card" onClick={(e) => e.stopPropagation()}>
            <div className="row-between" style={{ marginTop: 0 }}>
              <h3 style={{ margin: 0 }}>할 일 수정</h3>
              <button className="link-btn" onClick={() => setEditing(null)}>닫기</button>
            </div>
            <div className="edit-form">
              <input
                className="title-input"
                value={editing.title}
                onChange={(e) => setEditing({ ...editing, title: e.target.value })}
              />
              <label className="field">
                <small className="muted">카테고리</small>
                <select value={editing.categoryId} onChange={(e) => setEditing({ ...editing, categoryId: e.target.value })}>
                  <option value="">카테고리 없음</option>
                  {cats.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <small className="muted">중요도</small>
                <select value={editing.priority} onChange={(e) => setEditing({ ...editing, priority: e.target.value })}>
                  {PRIORITY.map((p) => (
                    <option key={p.v} value={p.v}>{p.label}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <small className="muted">마감</small>
                <input
                  type="datetime-local"
                  value={editing.dueAt}
                  onChange={(e) => setEditing({ ...editing, dueAt: e.target.value })}
                />
                <QuickButtons onPick={(v) => setEditing({ ...editing, dueAt: v })} />
              </label>
              <label className="field">
                <small className="muted">반복</small>
                <select
                  value={editing.repeat}
                  disabled={!editing.dueAt}
                  onChange={(e) => setEditing({ ...editing, repeat: e.target.value })}
                >
                  {Object.entries(REPEAT_LABEL).map(([v, label]) => (
                    <option key={v} value={v}>{label}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="btn-group" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
              <button className="link-btn" onClick={() => setEditing(null)}>취소</button>
              <button className="btn-dark" onClick={saveEdit}>저장</button>
            </div>
          </div>
        </div>
      )}

      {catOpen && (
        <div className="modal-backdrop" onClick={() => setCatOpen(false)}>
          <div className="modal card" onClick={(e) => e.stopPropagation()}>
            <div className="row-between" style={{ marginTop: 0 }}>
              <h3 style={{ margin: 0 }}>카테고리 관리</h3>
              <button className="link-btn" onClick={() => setCatOpen(false)}>닫기</button>
            </div>
            <form className="row-inline" style={{ marginTop: 14 }} onSubmit={addCategory}>
              <input
                placeholder="새 카테고리 (예: work, family, dohyun)"
                value={newCat}
                onChange={(e) => setNewCat(e.target.value)}
              />
              <button className="btn-dark" type="submit">추가</button>
            </form>
            <ul className="cat-manage">
              {cats.length === 0 && <li className="muted">아직 카테고리가 없어요.</li>}
              {cats.map((c, i) => (
                <li key={c.id}>
                  <i className="cat-dot" style={{ background: catStyleOf(c.name, i).bg }} />
                  <span className="cat-manage-name">{c.name}</span>
                  <small className="muted">{countFor(c.id)}개</small>
                  <button className="link-btn" onClick={() => deleteCategory(c)}>삭제</button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="card">
        <div className="filter-head">
          <button className={`chip filter-toggle ${filtersOpen || activeFilterCount > 0 ? "active" : ""}`} onClick={() => setFiltersOpen((o) => !o)} aria-expanded={filtersOpen}>
            필터{activeFilterCount > 0 ? ` ${activeFilterCount}` : ""} {filtersOpen ? "▴" : "▾"}
          </button>
            <div className="view-switch">
              <button className={`chip ${view === 'board' ? 'active' : ''}`} onClick={() => setView('board')}>보드</button>
              <button className={`chip ${view === 'list' ? 'active' : ''}`} onClick={() => setView('list')}>목록</button>
            </div>
          </div>
        <div className={`filter-grid ${filtersOpen ? "open" : ""}`}>
        <div className="filter-row">
          <span className="filter-label">카테고리</span>
          <div className="chip-bar">
            <button className={`chip ${catFilter === 'all' ? 'active' : ''}`} onClick={() => setCatFilter('all')}>
              전체
            </button>
            {cats.map((c, i) => (
              <button
                key={c.id}
                className={`chip ${catFilter === c.id ? 'active' : ''}`}
                onClick={() => {
                  setCatFilter(c.id);
                  // 특정 카테고리를 고르면 아래 입력칸의 카테고리도 같이 바꿉니다.
                  setForm((f) => ({ ...f, categoryId: c.id }));
                }}
              >
                <i className="cat-dot" style={{ background: catStyleOf(c.name, i).bg }} />
                {c.name} <small>{countFor(c.id)}</small>
              </button>
            ))}
            <button className="chip" onClick={() => setCatOpen(true)}>＋ 관리</button>
          </div>
        </div>

        <div className="filter-row">
          <span className="filter-label">현황</span>
          <div className="chip-bar">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.v}
                className={`chip ${statusFilter === f.v ? 'active' : ''}`}
                onClick={() => setStatusFilter(f.v)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="filter-row">
          <span className="filter-label">기간</span>
          <div className="chip-bar">
            {DUE_FILTERS.map((f) => (
              <button
                key={f.v}
                className={`chip ${dueFilter === f.v ? 'active' : ''}`}
                onClick={() => setDueFilter(f.v)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="filter-row">
          <span className="filter-label">중요도</span>
          <div className="chip-bar">
            <button className={`chip ${prioFilter === 'all' ? 'active' : ''}`} onClick={() => setPrioFilter('all')}>
              전체
            </button>
            {PRIORITY.map((p) => (
              <button
                key={p.v}
                className={`chip ${prioFilter === p.v ? 'active' : ''}`}
                onClick={() => setPrioFilter(p.v)}
              >
                <i className="prio-dot" style={{ background: p.color }} />
                {p.label}
              </button>
            ))}
          </div>
        </div>
        </div>
      </div>

      <form className="card task-form" onSubmit={submit}>
        <div className="task-row">
          <input
            className="title-input"
            placeholder="할 일을 입력하세요"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
          <button className="btn-dark" type="submit">추가</button>
        </div>
        <div className="task-row">
          <select
            className="compact-select"
            value={form.categoryId}
            onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
            aria-label="카테고리"
          >
            <option value="">카테고리 없음</option>
            {cats.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <select
            className="compact-select"
            value={form.priority}
            onChange={(e) => setForm({ ...form, priority: e.target.value })}
            aria-label="중요도"
          >
            {PRIORITY.map((p) => (
              <option key={p.v} value={p.v}>{p.label}</option>
            ))}
          </select>
          <select
            className="compact-select"
            value={form.repeat}
            disabled={!form.dueAt}
            onChange={(e) => setForm({ ...form, repeat: e.target.value })}
            aria-label="반복"
          >
            {Object.entries(REPEAT_LABEL).map(([v, label]) => (
              <option key={v} value={v}>{label}</option>
            ))}
          </select>
          <span className="inline-date">
            <small className="muted">마감</small>
            <input
              type="datetime-local"
              className="compact-date"
              value={form.dueAt}
              onChange={(e) => setForm({ ...form, dueAt: e.target.value })}
            />
            <QuickButtons onPick={(v) => setForm({ ...form, dueAt: v })} />
          </span>
        </div>
      </form>

      {view === 'board' ? (
        !ready ? null : (
          <div className="board">
            {columns.map((col) => (
              <div
                key={col.v}
                className={`board-col col-${col.v}`}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => dropTo(col.v)}
              >
                <div className="board-head">
                  <span>{col.label}</span>
                  <span className="board-head-actions">
                    <small>{col.items.length}</small>
                    {col.items.length > 0 && (
                      <button className="link-btn" onClick={() => clearColumn(col)}>전체 삭제</button>
                    )}
                  </span>
                </div>
                {col.items.map((t) => renderCard(t))}
                {col.items.length === 0 && <p className="muted board-empty">여기로 끌어다 놓으세요</p>}
              </div>
            ))}
          </div>
        )
      ) : (
        <div className="card">
          {!ready ? null : visible.length === 0 ? (
            <p className="muted">표시할 할 일이 없어요.</p>
          ) : (
            <ul className="list">
              {visible.map((t) => {
                const s = statusOf(t);
                const isDone = s === 'done';
                const overdue = !isDone && t.dueAt && new Date(t.dueAt).getTime() < now;
                const badge = dueBadge(t);
                const p = prioOf(t);
                return (
                  <li key={t.id} style={{ '--cat': catStyle(t.categoryId)?.bg ?? 'transparent' }} className="list-row-cat">
                    <input type="checkbox" className="check" checked={isDone} onChange={() => toggle(t)} />
                    <div className="list-main">
                      {/* 1줄: 중요도 · 카테고리 · 마감 배지 */}
                      <div className="todo-tagline">
                        <span className="prio-dot" style={{ background: PRIORITY_COLOR[p] }} title={`중요도 ${PRIORITY_LABEL[p]}`} />
                        {catName(t.categoryId) && (
                          <span className="tag" style={catTag(t.categoryId)}>{catName(t.categoryId)}</span>
                        )}
                        {badge && <span className={`due-badge ${badge.cls}`}>{badge.text}</span>}
                      </div>
                      {/* 2줄: 본문 */}
                      <div className={`todo-body ${isDone ? 'done-text' : ''}`}>{t.title}</div>
                      {/* 3줄: 마감 · 알림 · 반복 */}
                      <small className={`todo-due ${overdue ? 'overdue' : 'muted'}`}>
                        {t.dueAt && `마감 ${formatDateTime(t.dueAt)}`}
                        {t.remindAt && ` · 알림 ${formatDateTime(t.remindAt)}`}
                        {t.repeat !== 'none' && ` · ${REPEAT_LABEL[t.repeat]}`}
                      </small>
                    </div>
                    {/* 4줄: 설정 (중요도, 상태, 수정/삭제) */}
                    <div className="todo-settings">
                    <select
                      className="prio-select"
                      value={p}
                      onChange={(e) => update(t.id, { priority: e.target.value })}
                      aria-label="중요도"
                    >
                      {PRIORITY.map((pr) => (
                        <option key={pr.v} value={pr.v}>{pr.label}</option>
                      ))}
                    </select>
                    <select
                      className={`status-select status-${s}`}
                      value={s}
                      onChange={(e) => setStatus(t, e.target.value)}
                    >
                      {STATUS.map((st) => (
                        <option key={st.v} value={st.v}>{STATUS_LABEL[st.v]}</option>
                      ))}
                    </select>
                    <span className="card-actions">
            <button className="link-btn" onClick={() => openEdit(t)}>수정</button>
            <button className="link-btn" onClick={() => removeTodo(t)}>삭제</button>
          </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
