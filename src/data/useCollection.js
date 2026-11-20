import { useCallback, useEffect, useState } from 'react';
import { repo, SYNCED_EVENT } from './repository';

export function useCollection(name) {
  const [rows, setRows] = useState([]);
  const [ready, setReady] = useState(false);

  const reload = useCallback(async () => {
    setRows(await repo.list(name));
    setReady(true);
  }, [name]);

  useEffect(() => {
    reload();
    // 다른 탭에서 바뀐 데이터도 반영
    const onStorage = (e) => {
      if (e.key && e.key.endsWith(name)) reload();
    };
    // 동기화로 다른 기기의 변경이 들어오면 다시 읽습니다.
    window.addEventListener('storage', onStorage);
    window.addEventListener(SYNCED_EVENT, reload);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(SYNCED_EVENT, reload);
    };
  }, [name, reload]);

  const add = useCallback(
    async (data) => {
      const row = await repo.create(name, data);
      await reload();
      return row;
    },
    [name, reload],
  );

  const update = useCallback(
    async (id, patch) => {
      await repo.update(name, id, patch);
      await reload();
    },
    [name, reload],
  );

  const remove = useCallback(
    async (id) => {
      await repo.remove(name, id);
      await reload();
    },
    [name, reload],
  );

  return { rows, ready, add, update, remove, reload };
}
