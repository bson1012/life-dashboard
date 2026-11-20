import { useEffect, useRef, useState } from 'react';
import Dashboard from './components/Dashboard';
import Ledger from './components/Ledger';
import Todos from './components/Todos';
import Journal from './components/Journal';
import Lists from './components/Lists';
import { repo } from './data/repository';
import { formatDateTime } from './utils/format';
import { PAGES, TABS, pageFromPath, toUrl } from './config/pages';
import './App.css';


const hasNotification = typeof Notification !== 'undefined';

export default function App() {
  // 현재 페이지는 주소 경로와 맞춰 둡니다. 알 수 없는 경로는 Home으로 보냅니다.
  const [tab, setTabState] = useState(() => pageFromPath(window.location.pathname) ?? 'home');
  const [alerts, setAlerts] = useState([]);
  const [navOpen, setNavOpen] = useState(false); // 휴대폰 하단 메뉴: 평소엔 숨기고 위로 밀면 나옵니다
  const navDrag = useRef(null);
  const [perm, setPerm] = useState(hasNotification ? Notification.permission : 'unsupported');

  function setTab(id) {
    const url = toUrl(PAGES[id].path);
    if (window.location.pathname !== url) window.history.pushState({}, '', url);
    setTabState(id);
  }

  // 브라우저 뒤로/앞으로 가기 때 주소에 맞는 페이지를 보여 줍니다.
  useEffect(() => {
    const onPop = () => setTabState(pageFromPath(window.location.pathname) ?? 'home');
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // 리마인더 체크: 30초마다 알림 시각이 지난 미완료 할 일을 찾아 알림
  useEffect(() => {
    async function check() {
      const todos = await repo.list('todos');
      const now = Date.now();
      for (const t of todos) {
        if (t.done || !t.remindAt || t.notifiedFor === t.remindAt) continue;
        if (new Date(t.remindAt).getTime() > now) continue;
        // 오프라인이면 저장할 수 없으니 이번 알림은 건너뛰고, 다음 확인 때 다시 봅니다.
        try {
          await repo.update('todos', t.id, { notifiedFor: t.remindAt });
        } catch {
          continue;
        }
        setAlerts((a) => [...a, { id: `${t.id}-${t.remindAt}`, title: t.title, time: t.remindAt }]);
        if (hasNotification && Notification.permission === 'granted') {
          new Notification('할 일 알림', { body: t.title });
        }
      }
    }
    check();
    const timer = setInterval(check, 30000);
    return () => clearInterval(timer);
  }, []);

  async function askPermission() {
    setPerm(await Notification.requestPermission());
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="logo">LD</span>
          <span>Life Dashboard</span>
        </div>
        <nav>
          {TABS.map((t) => (
            <button key={t.id} className={`nav-item ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
              <img className="nav-icon" src={t.icon} alt="" />
              {t.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          {perm === 'default' && (
            <button className="btn-light" onClick={askPermission}>알림 켜기</button>
          )}
          <small className="muted">데이터는 이 브라우저에 저장됩니다</small>
        </div>
      </aside>

      <main className={`main ${tab === 'home' ? 'main-home' : ''}`}>
        {tab === 'home' && <Dashboard onNavigate={setTab} />}
        {tab === 'ledger' && <Ledger />}
        {tab === 'todos' && <Todos />}
        {tab === 'journal' && <Journal />}
        {tab === 'lists' && <Lists />}
      </main>

      <nav
        className={`tabbar ${navOpen ? 'open' : ''}`}
        aria-label="페이지 메뉴"
      >
        {/* 손잡이: 누르거나 위로 밀면 메뉴가 올라옵니다 */}
        <button
          type="button"
          className="tabbar-handle"
          aria-label={navOpen ? '메뉴 접기' : '메뉴 열기'}
          aria-expanded={navOpen}
          onClick={() => setNavOpen((o) => !o)}
          onTouchStart={(e) => {
            navDrag.current = e.touches[0].clientY;
          }}
          onTouchEnd={(e) => {
            const start = navDrag.current;
            navDrag.current = null;
            if (start == null) return;
            const dy = e.changedTouches[0].clientY - start;
            if (dy < -30) setNavOpen(true);
            if (dy > 30) setNavOpen(false);
          }}
        >
          <span />
        </button>
        <div className="tabbar-items">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={tab === t.id ? 'active' : ''}
              aria-label={t.label}
              title={t.label}
              onClick={() => {
                setTab(t.id);
                setNavOpen(false);
              }}
            >
              <img className="nav-icon" src={t.icon} alt="" />
              <span className="tab-label">{t.label}</span>
            </button>
          ))}
        </div>
      </nav>

      <div className="toasts">
        {alerts.map((a) => (
          <div className="toast" key={a.id}>
            <div>
              <b>⏰ {a.title}</b>
              <small>{formatDateTime(a.time)}</small>
            </div>
            <button className="link-btn" onClick={() => setAlerts((x) => x.filter((y) => y.id !== a.id))}>
              닫기
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
