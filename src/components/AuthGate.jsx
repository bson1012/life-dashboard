// 로그인 관문과 동기화 시작점. 혼자 쓰는 고정 계정 한 개를 기준으로 합니다.
// - Supabase 설정이 없으면 이 기기에서만 동작하고 로그인은 물어보지 않습니다.
// - 로그인 세션은 이 브라우저에 남아서, 한 번 로그인하면 다음부터는 바로 들어갑니다.
// - 인터넷이 끊겨 있으면 이 기기에 남아 있던 데이터로 조회만 할 수 있습니다(저장은 막힘).
import { useEffect, useState } from 'react';
import { supabase } from '../data/supabase';
import { repo } from '../data/repository';

const SYNC_EVERY_MS = 60000;

// 이 기기에 저장된 데이터가 있는지 봅니다. 동기화 기록과 시드 플래그는 뺍니다.
function hasLocalData() {
  return Object.keys(localStorage).some(
    (k) => k.startsWith('lifeDashboard:') && !k.includes(':sync') && !k.includes(':seeded'),
  );
}

export function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

async function syncOrAlert() {
  try {
    await repo.sync();
  } catch (e) {
    window.alert(e.message);
  }
}

export default function AuthGate({ children }) {
  const online = useOnline();
  // checking | login | ready | offline. 설정이 없으면 바로 ready 입니다.
  const [phase, setPhase] = useState(supabase ? 'checking' : 'ready');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // 저장 실패(오프라인 포함)를 화면에 알려 줍니다.
  useEffect(() => {
    if (!supabase) return;
    const onError = (e) => {
      if (e.reason?.message) window.alert(e.reason.message);
    };
    window.addEventListener('unhandledrejection', onError);
    return () => window.removeEventListener('unhandledrejection', onError);
  }, []);

  // 시작: 세션 확인 → 있으면 동기화하고 들어갑니다.
  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!alive) return;
      if (data?.session) {
        await syncOrAlert();
        if (alive) setPhase('ready');
      } else if (!navigator.onLine && hasLocalData()) {
        setPhase('offline');
      } else {
        setPhase('login');
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // 들어간 뒤에는 주기적으로, 그리고 다시 연결되거나 창에 돌아올 때 다른 기기의 변경을 가져옵니다.
  useEffect(() => {
    if (!supabase || phase !== 'ready') return;
    const run = () => {
      if (navigator.onLine) repo.sync().catch(() => {});
    };
    const timer = setInterval(run, SYNC_EVERY_MS);
    window.addEventListener('online', run);
    window.addEventListener('focus', run);
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', run);
      window.removeEventListener('focus', run);
    };
  }, [phase]);

  async function login(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (authError) {
      setError(navigator.onLine ? '이메일 또는 비밀번호가 맞지 않아요.' : '인터넷에 연결한 뒤 다시 로그인해 주세요.');
      setBusy(false);
      return;
    }
    setPassword('');
    await syncOrAlert();
    setPhase('ready');
    setBusy(false);
  }

  if (phase === 'checking') {
    return <p className="muted" style={{ textAlign: 'center', marginTop: 80 }}>불러오는 중…</p>;
  }

  if (phase === 'login') {
    return (
      <form
        className="card"
        onSubmit={login}
        style={{ maxWidth: 360, margin: '80px auto', display: 'grid', gap: 10 }}
      >
        <h3 style={{ margin: 0 }}>로그인</h3>
        <input
          type="email"
          placeholder="이메일"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          type="password"
          placeholder="비밀번호"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && <small style={{ color: '#b3261e' }}>{error}</small>}
        <button className="btn-dark" type="submit" disabled={busy || !online}>
          {busy ? '로그인 중…' : '로그인'}
        </button>
        {!online && <small className="muted">인터넷 연결이 없어서 로그인할 수 없어요.</small>}
      </form>
    );
  }

  return (
    <>
      {!online && (
        <div
          role="status"
          style={{
            background: '#fde9a8',
            color: '#5a4306',
            textAlign: 'center',
            fontSize: 13,
            padding: '6px 12px',
          }}
        >
          오프라인입니다. 조회만 할 수 있고, 저장은 인터넷에 연결된 뒤에 가능해요.
        </div>
      )}
      {children}
    </>
  );
}
