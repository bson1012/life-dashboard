// 홈 맨 아래 "관리": 모든 데이터 내보내기 / 가져오기 (JSON 파일)
import { useRef, useState } from 'react';
import { downloadBackup, importBackup } from '../utils/backup';

export default function DataManager({ onClose }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function onPick(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // 같은 파일을 다시 골라도 바뀌도록 비웁니다
    if (!file) return;
    const ok = window.confirm(
      `"${file.name}" 파일을 가져올까요?\n\n같은 항목은 더 최근에 고친 쪽을 남기고, 파일에만 있는 항목은 추가합니다.\n지금 있는 항목 중 파일에 없는 것은 지우지 않습니다.`,
    );
    if (!ok) return;

    setBusy(true);
    setError('');
    setMessage('');
    try {
      const r = await importBackup(await file.text());
      setMessage(`가져오기 완료: 새로 추가 ${r.added}건, 업데이트 ${r.updated}건, 그대로 둠 ${r.skipped}건`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <div className="row-between" style={{ marginTop: 0 }}>
          <h3 style={{ margin: 0 }}>관리</h3>
          <button className="link-btn" onClick={onClose}>닫기</button>
        </div>

        <section style={{ display: 'grid', gap: 8, marginTop: 16 }}>
          <h4 style={{ margin: 0 }}>내보내기</h4>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            가계부, 할 일, 목록, 일기, 설정 등 모든 데이터를 JSON 파일 하나로 저장합니다.
          </p>
          <button className="btn-dark" onClick={() => downloadBackup()} disabled={busy}>
            모든 데이터 내보내기
          </button>
        </section>

        <section style={{ display: 'grid', gap: 8, marginTop: 20 }}>
          <h4 style={{ margin: 0 }}>가져오기</h4>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            내보내기로 받은 JSON 파일을 고르면 이 기기의 데이터와 합칩니다.
          </p>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={onPick} />
          <button className="btn-light" onClick={() => fileRef.current?.click()} disabled={busy}>
            {busy ? '가져오는 중…' : '파일 가져오기'}
          </button>
        </section>

        {message && <p style={{ marginTop: 16, fontSize: 14 }}>{message}</p>}
        {error && <p style={{ marginTop: 16, fontSize: 14, color: '#b3261e' }}>{error}</p>}
      </div>
    </div>
  );
}
