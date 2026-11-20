-- 생활 대시보드 저장소 테이블 (Supabase SQL Editor에서 한 번 실행합니다)
-- 기존 프로젝트의 public 스키마에 넣습니다. 다른 테이블과 겹치지 않도록 life_dashboard_ 접두사를 씁니다.
-- 모든 컬렉션(거래, 결제수단, 할 일 등)을 한 테이블에 행 단위로 담습니다.
-- data 에는 앱이 만든 행 전체(id, createdAt, updatedAt, deleted 포함)를 그대로 넣습니다.

create table if not exists public.life_dashboard_records (
  id uuid primary key,
  collection text not null,
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  data jsonb not null,
  -- 동기화 기준 시각. 서버 시각을 쓰므로 기기 시계가 달라도 변경분을 빠짐없이 가져옵니다.
  server_at timestamptz not null default now()
);

create index if not exists life_dashboard_records_owner_server_idx
  on public.life_dashboard_records (owner, server_at);
create index if not exists life_dashboard_records_owner_collection_idx
  on public.life_dashboard_records (owner, collection);

create or replace function public.life_dashboard_touch_server_at()
returns trigger
language plpgsql
as $$
begin
  new.server_at := now();
  return new;
end;
$$;

drop trigger if exists life_dashboard_records_touch on public.life_dashboard_records;
create trigger life_dashboard_records_touch
  before insert or update on public.life_dashboard_records
  for each row execute function public.life_dashboard_touch_server_at();

-- 본인 데이터만 읽고 쓸 수 있습니다.
alter table public.life_dashboard_records enable row level security;

drop policy if exists "life dashboard owner only" on public.life_dashboard_records;
create policy "life dashboard owner only" on public.life_dashboard_records
  for all
  using (owner = auth.uid())
  with check (owner = auth.uid());
