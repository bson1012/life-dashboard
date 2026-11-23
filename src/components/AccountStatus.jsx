// 로그인·동기화 상태를 보여 주고, 로그아웃 버튼을 둡니다. 사이드바와 휴대폰 메뉴에서 씁니다.
import { useAuth } from './AuthGate';
import { formatDateTime } from '../utils/format';

function Dot({ tone }) {
  return <span className={`account-dot account-dot-${tone}`} aria-hidden="true" />;
}

export default function AccountStatus() {
  const { mode, online, user, lastSyncAt, syncError, signOut, goLogin } = useAuth();

  if (mode === 'local') {
    return (
      <div className="account-status">
        <p className="account-line"><Dot tone="local" />로컬 모드 · 이 기기에만 저장</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="account-status">
        <p className="account-line">
          <Dot tone="off" />
          {online ? '로그인 안 됨 · 조회만 가능' : '오프라인 · 로그인 안 됨'}
        </p>
        {online && (
          <button className="btn-light" onClick={goLogin}>로그인</button>
        )}
      </div>
    );
  }

  const tone = !online ? 'off' : syncError ? 'warn' : 'ok';
  const text = !online ? '오프라인 · 조회만 가능' : syncError ? '동기화 실패' : '동기화됨';
  const detail = syncError
    ? syncError
    : lastSyncAt
      ? `마지막 동기화 ${formatDateTime(lastSyncAt)}`
      : '동기화 중…';

  return (
    <div className="account-status">
      <p className="account-line"><Dot tone={tone} />{text}</p>
      <p className="account-email" title={user.email}>{user.email ?? '로그인됨'}</p>
      <small className="muted account-detail">{detail}</small>
      <button
        className="btn-light"
        onClick={signOut}
        disabled={!online}
        title={online ? '' : '인터넷에 연결된 뒤 로그아웃할 수 있어요'}
      >
        로그아웃
      </button>
    </div>
  );
}
