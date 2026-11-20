// 전체 데이터 내보내기 / 가져오기.
// 파일 형식은 기존 백업 파일과 같습니다: { "lifeDashboard:<컬렉션>": "<JSON 배열 문자열>", ... }
import { repo, SYNCED_EVENT } from '../data/repository';

const PREFIX = 'lifeDashboard:';

// 컬렉션 키인지 봅니다. 동기화 기록(:sync)과 시드 플래그(:seeded)는 제외합니다.
function isCollectionKey(key) {
  return key.startsWith(PREFIX) && !key.slice(PREFIX.length).includes(':');
}

// 이 기기의 모든 컬렉션(삭제 표시된 행 포함)을 모읍니다.
export function collectBackup() {
  const data = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (isCollectionKey(key)) data[key] = localStorage.getItem(key);
  }
  return data;
}

export function downloadBackup() {
  const blob = new Blob([JSON.stringify(collectBackup(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const day = new Date().toISOString().slice(0, 10);
  const a = document.createElement('a');
  a.href = url;
  a.download = `life-dashboard-backup-${day}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// 파일의 행을 컬렉션별로 저장합니다.
// - 같은 id 가 있으면 updatedAt 이 더 새것을 남깁니다.
// - 파일에만 있는 항목은 추가합니다.
// - 파일에 없는 기존 항목은 지우지 않습니다.
export async function importBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('파일을 읽을 수 없어요. 내보내기로 받은 JSON 파일인지 확인해 주세요.');
  }
  const entries = Object.entries(data ?? {}).filter(([k, v]) => isCollectionKey(k) && typeof v === 'string');
  if (!entries.length) throw new Error('가져올 데이터가 없어요. 내보내기로 받은 파일인지 확인해 주세요.');

  const result = { added: 0, updated: 0, skipped: 0 };
  try {
    for (const [key, value] of entries) {
      const name = key.slice(PREFIX.length);
      let rows;
      try {
        rows = JSON.parse(value);
      } catch {
        continue;
      }
      if (!Array.isArray(rows)) continue;

      const current = new Map(repo.read(name).map((r) => [r.id, r]));
      for (const row of rows) {
        if (!row?.id) continue;
        const old = current.get(row.id);
        if (old && (old.updatedAt ?? '') >= (row.updatedAt ?? '')) {
          result.skipped++;
          continue;
        }
        await repo.commit(name, row);
        if (old) result.updated++;
        else result.added++;
      }
    }
  } finally {
    // 중간에 실패해도 지금까지 저장된 내용은 화면에 바로 보이도록 알립니다.
    window.dispatchEvent(new Event(SYNCED_EVENT));
  }
  return result;
}
