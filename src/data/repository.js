// 저장소. 모든 데이터는 여기를 거칩니다.
// - LocalRepository: 이 기기의 localStorage 에만 저장합니다.
// - CloudRepository: Supabase 에 저장하고, 같은 내용을 localStorage 에 캐시로 둡니다.
//   · 읽기는 항상 캐시에서 합니다. 그래서 인터넷이 끊겨도 조회는 됩니다.
//   · 쓰기는 서버에 먼저 저장된 뒤에만 캐시에 반영합니다. 오프라인이면 저장을 막습니다(조회만 가능).
//   · 다른 기기의 변경은 sync() 로 가져옵니다. 변경분만 받으며, 같은 행은 updatedAt 이 더 새것을 씁니다.
// 삭제는 소프트 삭제(deleted: true)로 처리해 기기 간 동기화에 맞춥니다.
import { supabase } from './supabase';

const PREFIX = 'lifeDashboard:';
const CURSOR_KEY = PREFIX + 'sync:cursor';
const PUSHED_KEY = PREFIX + 'sync:pushed';
// 기존 Supabase 프로젝트 안에서 다른 테이블과 이름이 겹치지 않도록 접두사를 붙입니다.
const TABLE = 'life_dashboard_records';
const PAGE = 1000;
const BATCH = 500;
// 서버 응답이 이 시간을 넘으면 동기화를 포기합니다. 멈춘 요청 때문에 다음 동기화가 막히지 않게 하려고요.
const SYNC_TIMEOUT_MS = 15000;
const newId = () => crypto.randomUUID();

// 동기화가 끝나면 이 이벤트를 보내서 화면이 다시 읽도록 합니다.
export const SYNCED_EVENT = 'lifeDashboard:synced';

export class OfflineError extends Error {
  constructor() {
    super('인터넷에 연결되어 있지 않아 저장할 수 없어요. 연결한 뒤 다시 시도해 주세요.');
    this.name = 'OfflineError';
  }
}

export class LocalRepository {
  read(collection) {
    try {
      return JSON.parse(localStorage.getItem(PREFIX + collection)) ?? [];
    } catch {
      return [];
    }
  }

  write(collection, rows) {
    localStorage.setItem(PREFIX + collection, JSON.stringify(rows));
  }

  async list(collection) {
    return this.read(collection).filter((r) => !r.deleted);
  }

  async create(collection, data) {
    const now = new Date().toISOString();
    const row = { ...data, id: newId(), createdAt: now, updatedAt: now, deleted: false };
    await this.commit(collection, row);
    return row;
  }

  async update(collection, id, patch) {
    const current = this.read(collection).find((r) => r.id === id);
    if (!current) return undefined;
    const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
    await this.commit(collection, next);
    return next;
  }

  async remove(collection, id) {
    return this.update(collection, id, { deleted: true });
  }

  // 행 하나를 저장합니다. 로컬에서는 캐시에만 씁니다.
  async commit(collection, row) {
    this.putCache(collection, row);
  }

  putCache(collection, row) {
    const rows = this.read(collection);
    const i = rows.findIndex((r) => r.id === row.id);
    if (i >= 0) rows[i] = row;
    else rows.push(row);
    this.write(collection, rows);
  }
}

export class CloudRepository extends LocalRepository {
  constructor(client) {
    super();
    this.client = client;
    this.syncing = null;
  }

  // 서버에 먼저 저장하고, 성공하면 캐시에 반영합니다.
  async commit(collection, row) {
    if (!navigator.onLine) throw new OfflineError();
    const { error } = await this.client
      .from(TABLE)
      .upsert({ id: row.id, collection, data: row }, { onConflict: 'id' });
    if (error) throw new Error(`저장에 실패했어요: ${error.message}`);
    this.putCache(collection, row);
  }

  // 다른 기기의 변경을 가져오고, 이 기기에만 있던 기존 데이터는 한 번 올립니다.
  // 같은 시점에 여러 번 불러도 한 번만 실행됩니다.
  sync() {
    if (!this.syncing) {
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('서버 응답이 늦어요. 인터넷 연결이나 회사 네트워크 설정을 확인해 주세요.')),
          SYNC_TIMEOUT_MS,
        );
      });
      this.syncing = Promise.race([this.#doSync(), timeout]).finally(() => {
        clearTimeout(timer);
        this.syncing = null;
      });
    }
    return this.syncing;
  }

  async #doSync() {
    if (!navigator.onLine) return;
    const { data } = await this.client.auth.getSession();
    if (!data.session) return;
    await this.pull();
    if (!localStorage.getItem(PUSHED_KEY)) await this.pushAll();
    window.dispatchEvent(new Event(SYNCED_EVENT));
  }

  async pull() {
    let cursor = localStorage.getItem(CURSOR_KEY) ?? '1970-01-01T00:00:00Z';
    for (;;) {
      const { data, error } = await this.client
        .from(TABLE)
        .select('id,collection,data,server_at')
        .gt('server_at', cursor)
        .order('server_at', { ascending: true })
        .limit(PAGE);
      if (error) throw new Error(`동기화에 실패했어요: ${error.message}`);
      if (!data.length) break;

      const groups = new Map();
      for (const r of data) {
        if (!groups.has(r.collection)) groups.set(r.collection, []);
        groups.get(r.collection).push(r.data);
      }
      for (const [collection, rows] of groups) this.mergeIntoCache(collection, rows);

      cursor = data[data.length - 1].server_at;
      localStorage.setItem(CURSOR_KEY, cursor);
      if (data.length < PAGE) break;
    }
  }

  mergeIntoCache(collection, incoming) {
    const rows = this.read(collection);
    const index = new Map(rows.map((r, i) => [r.id, i]));
    for (const row of incoming) {
      const i = index.get(row.id);
      if (i === undefined) {
        rows.push(row);
        index.set(row.id, rows.length - 1);
      } else if ((row.updatedAt ?? '') >= (rows[i].updatedAt ?? '')) {
        rows[i] = row;
      }
    }
    this.write(collection, rows);
  }

  async pushAll() {
    const payload = [];
    for (const collection of this.collections()) {
      for (const row of this.read(collection)) payload.push({ id: row.id, collection, data: row });
    }
    for (let i = 0; i < payload.length; i += BATCH) {
      const { error } = await this.client.from(TABLE).upsert(payload.slice(i, i + BATCH), { onConflict: 'id' });
      if (error) throw new Error(`기존 데이터를 올리지 못했어요: ${error.message}`);
    }
    localStorage.setItem(PUSHED_KEY, '1');
  }

  // 이 기기에 있는 컬렉션 이름 목록 (lifeDashboard:<이름> 형태의 키)
  collections() {
    const names = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key.startsWith(PREFIX)) continue;
      const name = key.slice(PREFIX.length);
      if (!name.includes(':')) names.push(name);
    }
    return names;
  }
}

export const repo = supabase ? new CloudRepository(supabase) : new LocalRepository();
