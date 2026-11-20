// 페이지 이름과 아이콘을 한 곳에서 관리합니다.
// 이름을 바꾸려면 여기 label만 고치면 메뉴와 각 페이지 제목에 모두 반영됩니다.
import homeIcon from '../assets/icons/home.png';
import moneyIcon from '../assets/icons/money.png';
import remindersIcon from '../assets/icons/reminders.png';
import listsIcon from '../assets/icons/lists.png';
import journalIcon from '../assets/icons/journal.png';

// path는 주소창에 보이는 경로입니다. 각 페이지로 바로 들어갈 수 있습니다.
export const PAGES = {
  home: { label: 'Home', icon: homeIcon, path: '/' },
  ledger: { label: 'Money', icon: moneyIcon, path: '/money' },
  todos: { label: 'Reminders', icon: remindersIcon, path: '/reminders' },
  lists: { label: 'Lists', icon: listsIcon, path: '/lists' },
  journal: { label: 'Journal', icon: journalIcon, path: '/journal' },
};

// 메뉴 표시 순서
export const PAGE_ORDER = ['home', 'ledger', 'todos', 'lists', 'journal'];

export const TABS = PAGE_ORDER.map((id) => ({ id, ...PAGES[id] }));

// 배포 주소의 기본 경로(GitHub Pages 저장소 이름 등). 끝 슬래시는 뺍니다. 로컬에서는 빈 문자열입니다.
const BASE = import.meta.env.BASE_URL.replace(/\/+$/, '');

// 페이지 경로(path)를 실제 주소창 경로로 바꿉니다.
export function toUrl(path) {
  return BASE + path;
}

// 주소 경로 → 페이지 id. 기본 경로와 끝의 슬래시는 무시하고, 알 수 없는 경로는 null을 돌려줍니다.
export function pageFromPath(pathname) {
  let clean = pathname;
  if (BASE && clean.startsWith(BASE)) clean = clean.slice(BASE.length);
  clean = clean.replace(/\/+$/, '') || '/';
  return PAGE_ORDER.find((id) => PAGES[id].path === clean) ?? null;
}
