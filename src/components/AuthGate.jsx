// 로그인 관문과 계정 상태. 혼자 쓰는 고정 계정 한 개를 기준으로 합니다.
// - Supabase 설정이 없으면(로컬 개발 등) 이 기기에만 저장하고 로그인은 묻지 않습니다.
// - 로그인하면 서버와 동기화합니다. 계정·온라인·동기화 상태는 AuthContext 로 화면에 알려 줍니다.
// - 로그아웃하면 이 브라우저의 캐시를 지워서, 다른 사람이 데이터를 보지 않게 합니다.
// - 인터넷이 끊겨 있어도 세션이 남아 있으면 이 기기의 데이터를 조회할 수 있습니다(저장은 막힘).
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { supabase } from '../data/supabase';
import { repo } from '../data/repository';

const SYNC_EVERY_MS = 60000;
const SESSION_TIMEOUT_MS = 8000;
const TIMED_OUT = Symbol('timed-out');

export const AuthContext = createContext({
  mode: 'local',
  online: true,
  user: null,
  lastSyncAt: null,
  syncError: '',
  signOut: null,
  goLogin: null,
});
export const useAuth = () => useContext(AuthContext);

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

// 이 기기에 로그인 없이 저장된 데이터가 있는지 봅니다. 동기화 기록과 시드 플래그는 뺍니다.
function hasLocalData() {
  return Object.keys(localStorage).some(
    (k) => k.startsWith('lifeDashboard:') && !k.includes(':sync') && !k.includes(':seeded'),
  );
}

// 저장된 세션을 확인합니다. 네트워크가 막혀 오래 걸리면 TIMED_OUT 을 돌려줍니다.
async function readSession() {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), SESSION_TIMEOUT_MS);
  });
  try {
    const res = await Promise.race([supabase.auth.getSession(), timeout]);
    if (res === TIMED_OUT) return TIMED_OUT;
    return res.data?.session ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export default function AuthGate({ children }) {
  const online = useOnline();
  // checking: 확인 중 | login: 로그인 화면 | ready: 앱 표시. 설정이 없으면 바로 ready 입니다.
  const [phase, setPhase] = useState(supabase ? 'checking' : 'ready');
  const [user, setUser] = useState(null);
  const [lastSyncAt, setLastSyncAt] = useState(null);
  const [syncError, setSyncError] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  // 저장 실패(오프라인 저장 시도 등)를 알려 줍니다.
  useEffect(() => {
    if (!supabase) return;
    const onError = (e) => {
      if (e.reason?.message) window.alert(e.reason.message);
    };
    window.addEventListener('unhandledrejection', onError);
    return () => window.removeEventListener('unhandledrejection', onError);
  }, []);

  // 서버와 동기화합니다. 실패해도 이 기기의 데이터는 그대로 보여 주고, 실패 사유만 상태에 적습니다.
  const syncNow = useCallback(async () => {
    try {
      await repo.sync();
      setLastSyncAt(new Date().toISOString());
      setSyncError('');
    } catch (e) {
      setSyncError(e.message);
    }
  }, []);

  // 세션이 확인되면 계정을 기록하고 앱을 보여 준 뒤 동기화합니다.
  const enter = useCallback(
    async (session) => {
      repo.setOwner(session.user.id);
      setUser(session.user);
      setNotice('');
      setPhase('ready');
      await syncNow();
    },
    [syncNow],
  );

  // 시작: 저장된 세션을 확인합니다.
  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    // 무슨 이유로든 20초가 넘도록 확인 중이면 로그인 화면으로 보냅니다.
    const watchdog = setTimeout(() => {
      if (alive) setPhase((p) => (p === 'checking' ? 'login' : p));
    }, 20000);

    (async () => {
      const session = await readSession();
      if (!alive) return;
      if (session && session !== TIMED_OUT) {
        await enter(session);
      } else if (session === TIMED_OUT) {
        setNotice('서버 응답이 늦어서 로그인 상태를 확인하지 못했어요. 인터넷 연결을 확인하고 다시 로그인해 주세요.');
        setPhase('login');
      } else if (!navigator.onLine && hasLocalData()) {
        // 로그인은 안 되어 있지만 인터넷이 없으니 이 기기의 데이터만 조회합니다.
        setPhase('ready');
      } else {
        setPhase('login');
      }
    })();

    // 다른 곳에서 로그아웃되었거나 세션이 만료되면 로그인 화면으로 돌아갑니다.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (!alive || event !== 'SIGNED_OUT') return;
      repo.clearLocal();
      setUser(null);
      setLastSyncAt(null);
      setPhase('login');
    });

    return () => {
      alive = false;
      clearTimeout(watchdog);
      sub.subscription.unsubscribe();
    };
  }, [enter]);

  // 로그인 상태에서는 주기적으로, 그리고 다시 연결되거나 창에 돌아올 때 다른 기기의 변경을 가져옵니다.
  useEffect(() => {
    if (!supabase || phase !== 'ready' || !user) return;
    const run = () => {
      if (navigator.onLine) syncNow();
    };
    const timer = setInterval(run, SYNC_EVERY_MS);
    window.addEventListener('online', run);
    window.addEventListener('focus', run);
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', run);
      window.removeEventListener('focus', run);
    };
  }, [phase, user, syncNow]);

  async function login(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    const { data, error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (authError || !data.session) {
      if (!navigator.onLine) setError('인터넷에 연결한 뒤 다시 로그인해 주세요.');
      else if (authError?.status === 400) setError('이메일 또는 비밀번호가 맞지 않아요.');
      else setError(`로그인에 실패했어요: ${authError?.message ?? '알 수 없는 오류'}`);
      setBusy(false);
      return;
    }
    setPassword('');
    await enter(data.session);
    setBusy(false);
  }

  // 로그아웃: 오프라인이면 서버에 알릴 수 없으니 막습니다. 성공하면 이 기기의 캐시를 지웁니다.
  const signOut = useCallback(async () => {
    if (!navigator.onLine) return;
    try {
      await supabase.auth.signOut();
    } catch {
      // 세션은 이 브라우저에서 이미 지워졌을 수 있으니 아래 정리는 그대로 진행합니다.
    }
    repo.clearLocal();
    setUser(null);
    setLastSyncAt(null);
    setSyncError('');
    setPassword('');
    setPhase('login');
  }, []);

  const goLogin = useCallback(() => setPhase('login'), []);

  const value = {
    mode: supabase ? 'cloud' : 'local',
    online,
    user,
    lastSyncAt,
    syncError,
    signOut,
    goLogin,
  };

  let content;
  if (phase === 'checking') {
    content = <p className="muted" style={{ textAlign: 'center', marginTop: 80 }}>불러오는 중…</p>;
  } else if (phase === 'login') {
    content = (
      <form
        className="card"
        onSubmit={login}
        style={{ maxWidth: 360, margin: '80px auto', display: 'grid', gap: 10 }}
      >
        <h3 style={{ margin: 0 }}>lifeHub 로그인</h3>
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
        {notice && <small className="muted">{notice}</small>}
        {error && <small style={{ color: '#b3261e' }}>{error}</small>}
        <button className="btn-dark" type="submit" disabled={busy || !online}>
          {busy ? '로그인 중…' : '로그인'}
        </button>
        {!online && <small className="muted">인터넷 연결이 없어서 로그인할 수 없어요.</small>}
      </form>
    );
  } else {
    content = (
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

  return <AuthContext.Provider value={value}>{content}</AuthContext.Provider>;
}
