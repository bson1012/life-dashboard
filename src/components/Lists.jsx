import { useState } from 'react';
import { useCollection } from '../data/useCollection';
import { PAGES } from '../config/pages';

const LIST_TYPES = [
  { v: 'plain', label: '일반 리스트' },
  { v: 'check', label: '체크 리스트' },
];
// 기존 리스트(유형 없음)는 일반 리스트로 읽습니다.
const typeOf = (l) => l.type ?? 'plain';
const TYPE_LABEL = Object.fromEntries(LIST_TYPES.map((t) => [t.v, t.label]));

export default function Lists() {
  const listsApi = useCollection('lists');
  const itemsApi = useCollection('listItems');

  const [selectedId, setSelectedId] = useState(null);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState('plain');
  const [draft, setDraft] = useState({ title: '', note: '' }); // 맨 아래 한 줄 입력
  const [editing, setEditing] = useState(null); // 인라인 수정 중인 항목
  const [dragId, setDragId] = useState(null);

  const lists = [...listsApi.rows].sort(
    (a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || a.createdAt.localeCompare(b.createdAt),
  );
  const current = lists.find((l) => l.id === selectedId) ?? lists[0] ?? null;
  const currentItems = current
    ? itemsApi.rows
        .filter((i) => i.listId === current.id)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    : [];
  const countOf = (listId) => itemsApi.rows.filter((i) => i.listId === listId).length;
  const isCheck = current && typeOf(current) === 'check';

  // 현재 순서를 order 값(0,1,2…)으로 저장합니다. 바뀐 것만 갱신합니다.
  async function saveOrder(arr) {
    for (let i = 0; i < arr.length; i++) {
      if (arr[i].order !== i) await listsApi.update(arr[i].id, { order: i });
    }
  }

  function moveList(idx, dir) {
    const next = [...lists];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    saveOrder(next);
  }

  function dropOn(targetId) {
    setDragId(null);
    if (!dragId || dragId === targetId) return;
    const from = lists.findIndex((l) => l.id === dragId);
    const to = lists.findIndex((l) => l.id === targetId);
    const next = [...lists];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    saveOrder(next);
  }

  function selectList(id) {
    setSelectedId(id);
    setEditing(null);
    setDraft({ title: '', note: '' });
  }

  async function createList(e) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    const created = await listsApi.add({ name, type: newType });
    setNewName('');
    selectList(created.id);
  }

  async function renameList() {
    if (!current) return;
    const name = window.prompt('리스트 이름', current.name);
    if (!name || !name.trim()) return;
    await listsApi.update(current.id, { name: name.trim() });
  }

  async function changeType() {
    if (!current) return;
    await listsApi.update(current.id, { type: isCheck ? 'plain' : 'check' });
  }

  async function deleteList() {
    if (!current || !window.confirm(`"${current.name}" 리스트와 안의 항목을 모두 삭제할까요?`)) return;
    for (const item of currentItems) await itemsApi.remove(item.id);
    await listsApi.remove(current.id);
    selectList(null);
  }

  // 맨 아래 한 줄 입력: 항목(필수) + 비고(선택)
  async function addItem(e) {
    e.preventDefault();
    if (!current || !draft.title.trim()) return;
    await itemsApi.add({
      listId: current.id,
      title: draft.title.trim(),
      note: draft.note.trim(),
      done: false,
    });
    setDraft({ title: '', note: '' });
  }

  async function toggleItem(item) {
    await itemsApi.update(item.id, { done: !item.done });
  }

  function startEdit(item) {
    setEditing({ id: item.id, title: item.title, note: item.note ?? '' });
  }

  async function saveEdit() {
    if (!editing || !editing.title.trim()) return;
    await itemsApi.update(editing.id, { title: editing.title.trim(), note: editing.note.trim() });
    setEditing(null);
  }

  async function removeItem(item) {
    if (!window.confirm(`"${item.title}" 항목을 삭제할까요?`)) return;
    await itemsApi.remove(item.id);
  }

  return (
    <div className="page">
      <div className="page-head">
        <h2>{PAGES.lists.label}</h2>
      </div>

      <div className="lists-layout">
        <aside className="card">
          <form className="list-create" onSubmit={createList}>
            <input
              placeholder="새 리스트 이름"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <div className="list-create-row">
              <select value={newType} onChange={(e) => setNewType(e.target.value)} aria-label="리스트 유형">
                {LIST_TYPES.map((t) => (
                  <option key={t.v} value={t.v}>{t.label}</option>
                ))}
              </select>
              <button className="btn-dark" type="submit">추가</button>
            </div>
          </form>
          {lists.length === 0 && (
            <p className="muted" style={{ marginTop: 14 }}>
              예: 계좌번호, 친구 생일, 장보기 체크 리스트
            </p>
          )}
          <ul className="list-index">
            {lists.map((l, idx) => (
              <li
                key={l.id}
                draggable
                className={dragId === l.id ? 'dragging' : ''}
                onDragStart={() => setDragId(l.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => dropOn(l.id)}
                onDragEnd={() => setDragId(null)}
              >
                <button
                  className={`list-pick ${current?.id === l.id ? 'active' : ''}`}
                  onClick={() => selectList(l.id)}
                >
                  <span className="grip" aria-hidden="true">⠿</span>
                  <span className="list-pick-name">{l.name}</span>
                  <small>{typeOf(l) === 'check' ? '☑ ' : ''}{countOf(l.id)}</small>
                </button>
                <span className="move-btns">
                  <button
                    className="move-btn"
                    disabled={idx === 0}
                    onClick={() => moveList(idx, -1)}
                    title="위로"
                  >
                    ▲
                  </button>
                  <button
                    className="move-btn"
                    disabled={idx === lists.length - 1}
                    onClick={() => moveList(idx, 1)}
                    title="아래로"
                  >
                    ▼
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </aside>

        <section className="lists-main">
          {!current ? (
            <div className="card">
              <p className="muted">왼쪽에서 리스트를 만들어 보세요.</p>
            </div>
          ) : (
            <>
              <div className="card">
                <div className="row-between" style={{ marginTop: 0 }}>
                  <div>
                    <h3 style={{ margin: 0 }}>{current.name}</h3>
                    <small className="muted">{TYPE_LABEL[typeOf(current)]}</small>
                  </div>
                  <div className="btn-group">
                    <button className="link-btn" onClick={changeType}>
                      {isCheck ? '일반 리스트로' : '체크 리스트로'}
                    </button>
                    <button className="link-btn" onClick={renameList}>이름 변경</button>
                    <button className="link-btn" onClick={deleteList}>리스트 삭제</button>
                  </div>
                </div>
              </div>

              <div className="card">
                {!itemsApi.ready ? null : currentItems.length === 0 ? (
                  <p className="muted">아직 항목이 없어요.</p>
                ) : (
                  <ul className="list">
                    {currentItems.map((item) =>
                      editing?.id === item.id ? (
                        <li key={item.id} className="item-row">
                          <div className="item-edit">
                            <input
                              className="title-input"
                              value={editing.title}
                              onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                            />
                            <input
                              value={editing.note}
                              placeholder="비고 (선택)"
                              onChange={(e) => setEditing({ ...editing, note: e.target.value })}
                            />
                          </div>
                          <div className="list-right">
                            <button className="link-btn" onClick={() => setEditing(null)}>취소</button>
                            <button className="link-btn" onClick={saveEdit}>저장</button>
                          </div>
                        </li>
                      ) : (
                        <li key={item.id} className={`item-row ${isCheck && item.done ? 'checked' : ''}`}>
                          {isCheck && (
                            <input
                              type="checkbox"
                              className="check"
                              checked={!!item.done}
                              onChange={() => toggleItem(item)}
                            />
                          )}
                          <div className="list-main">
                            <b>{item.title}</b>
                            {item.note && <small className="item-note">{item.note}</small>}
                          </div>
                          <div className="list-right">
                            <button className="link-btn" onClick={() => startEdit(item)}>수정</button>
                            <button className="link-btn" onClick={() => removeItem(item)}>삭제</button>
                          </div>
                        </li>
                      ),
                    )}
                  </ul>
                )}

                <form className="item-add" onSubmit={addItem}>
                  <input
                    placeholder="항목"
                    value={draft.title}
                    onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  />
                  <input
                    placeholder="비고 (선택)"
                    value={draft.note}
                    onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                  />
                  <button className="btn-dark" type="submit">추가</button>
                </form>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
