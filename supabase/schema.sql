-- 에스프레소 베리에이션 실습 노트 : Supabase 설정
-- SQL Editor에 전체를 붙여넣고 한 번 실행하면 됩니다.
-- 모든 이름에 ev_ 접두어를 붙여서, 기존 프로젝트(온보딩 툴 등)에 같이 써도 겹치지 않습니다.

create extension if not exists pgcrypto;

-- 1. 테이블 ------------------------------------------------------------

create table if not exists public.ev_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

create table if not exists public.ev_cohorts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  title text not null default '에스프레소 베리에이션',
  dates date[] not null,                 -- 1~3일차 날짜
  created_at timestamptz not null default now()
);

create table if not exists public.ev_students (
  id uuid primary key default gen_random_uuid(),
  cohort_id uuid not null references public.ev_cohorts(id) on delete cascade,
  name text not null,
  auth_uid uuid,                         -- 지금 이 교육생으로 접속한 기기
  created_at timestamptz not null default now(),
  unique (cohort_id, name)
);

create table if not exists public.ev_attendance (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.ev_students(id) on delete cascade,
  day smallint not null check (day between 1 and 3),
  status text not null check (status in ('출석', '지각')),
  checked_at timestamptz not null default now(),
  unique (student_id, day)
);

create table if not exists public.ev_feedback (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.ev_students(id) on delete cascade,
  category text not null check (category in ('espresso', 'latte', 'cappuccino')),
  items text[] not null default '{}',
  memo text not null default '',
  day smallint,
  resolved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ev_photos (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.ev_students(id) on delete cascade,
  kind text not null check (kind in ('latte', 'cappuccino')),
  path text not null,
  created_at timestamptz not null default now(),
  unique (student_id, kind)
);

create table if not exists public.ev_surveys (
  student_id uuid primary key references public.ev_students(id) on delete cascade,
  q1 smallint not null check (q1 between 1 and 5),
  q2 smallint not null check (q2 between 1 and 5),
  q3 smallint not null check (q3 between 1 and 5),
  q4 smallint not null check (q4 between 1 and 5),
  comment text not null default '',
  submitted_at timestamptz not null default now()
);

create index if not exists ev_students_cohort_idx on public.ev_students(cohort_id);
create index if not exists ev_students_auth_idx on public.ev_students(auth_uid);
create index if not exists ev_feedback_student_idx on public.ev_feedback(student_id);

-- 2. 함수 ------------------------------------------------------------

create or replace function public.ev_is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.ev_admins where user_id = auth.uid());
$$;

create or replace function public.ev_my_student_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select id from public.ev_students where auth_uid = auth.uid();
$$;

-- 기수 코드 + 이름으로 입장. 같은 이름이 이미 있으면 그 기록을 이어서 씀(기기를 바꿔도 이어짐)
create or replace function public.ev_join_cohort(p_code text, p_name text)
returns json language plpgsql security definer set search_path = public as $$
declare
  c public.ev_cohorts;
  s public.ev_students;
  n text;
begin
  if auth.uid() is null then
    raise exception 'NOT_SIGNED_IN';
  end if;
  select * into c from public.ev_cohorts where upper(code) = upper(trim(p_code));
  if not found then
    raise exception 'COHORT_NOT_FOUND';
  end if;
  n := regexp_replace(coalesce(p_name, ''), '\s+', '', 'g');
  if length(n) = 0 then
    raise exception 'NAME_REQUIRED';
  end if;
  insert into public.ev_students (cohort_id, name, auth_uid)
  values (c.id, n, auth.uid())
  on conflict (cohort_id, name) do update set auth_uid = excluded.auth_uid
  returning * into s;
  return json_build_object(
    'student_id', s.id, 'name', s.name,
    'code', c.code, 'title', c.title, 'dates', c.dates
  );
end;
$$;

grant execute on function public.ev_is_admin() to authenticated;
grant execute on function public.ev_my_student_ids() to authenticated;
grant execute on function public.ev_join_cohort(text, text) to authenticated;

-- 3. 권한(RLS) ------------------------------------------------------------
-- 교육생: 자기 기록만 보고 쓸 수 있음 / 강사(ev_admins에 등록된 계정): 전부

alter table public.ev_admins enable row level security;
alter table public.ev_cohorts enable row level security;
alter table public.ev_students enable row level security;
alter table public.ev_attendance enable row level security;
alter table public.ev_feedback enable row level security;
alter table public.ev_photos enable row level security;
alter table public.ev_surveys enable row level security;

drop policy if exists ev_admins_self on public.ev_admins;
create policy ev_admins_self on public.ev_admins for select using (user_id = auth.uid());

drop policy if exists ev_cohorts_admin on public.ev_cohorts;
create policy ev_cohorts_admin on public.ev_cohorts for all using (public.ev_is_admin()) with check (public.ev_is_admin());
drop policy if exists ev_cohorts_student on public.ev_cohorts;
create policy ev_cohorts_student on public.ev_cohorts for select
  using (id in (select cohort_id from public.ev_students where auth_uid = auth.uid()));

drop policy if exists ev_students_admin on public.ev_students;
create policy ev_students_admin on public.ev_students for all using (public.ev_is_admin()) with check (public.ev_is_admin());
drop policy if exists ev_students_self on public.ev_students;
create policy ev_students_self on public.ev_students for select using (auth_uid = auth.uid());

drop policy if exists ev_att_admin on public.ev_attendance;
create policy ev_att_admin on public.ev_attendance for all using (public.ev_is_admin()) with check (public.ev_is_admin());
drop policy if exists ev_att_self_read on public.ev_attendance;
create policy ev_att_self_read on public.ev_attendance for select using (student_id in (select public.ev_my_student_ids()));
drop policy if exists ev_att_self_insert on public.ev_attendance;
create policy ev_att_self_insert on public.ev_attendance for insert with check (student_id in (select public.ev_my_student_ids()));

drop policy if exists ev_fb_admin on public.ev_feedback;
create policy ev_fb_admin on public.ev_feedback for all using (public.ev_is_admin()) with check (public.ev_is_admin());
drop policy if exists ev_fb_self on public.ev_feedback;
create policy ev_fb_self on public.ev_feedback for all
  using (student_id in (select public.ev_my_student_ids()))
  with check (student_id in (select public.ev_my_student_ids()));

drop policy if exists ev_photos_admin on public.ev_photos;
create policy ev_photos_admin on public.ev_photos for all using (public.ev_is_admin()) with check (public.ev_is_admin());
drop policy if exists ev_photos_self on public.ev_photos;
create policy ev_photos_self on public.ev_photos for all
  using (student_id in (select public.ev_my_student_ids()))
  with check (student_id in (select public.ev_my_student_ids()));

drop policy if exists ev_surveys_admin on public.ev_surveys;
create policy ev_surveys_admin on public.ev_surveys for all using (public.ev_is_admin()) with check (public.ev_is_admin());
drop policy if exists ev_surveys_self_read on public.ev_surveys;
create policy ev_surveys_self_read on public.ev_surveys for select using (student_id in (select public.ev_my_student_ids()));
drop policy if exists ev_surveys_self_insert on public.ev_surveys;
create policy ev_surveys_self_insert on public.ev_surveys for insert with check (student_id in (select public.ev_my_student_ids()));

-- 4. 사진 저장소 ------------------------------------------------------------
-- 비공개 버킷. 경로는 "교육생ID/파일명.jpg"

insert into storage.buckets (id, name, public)
values ('ev-photos', 'ev-photos', false)
on conflict (id) do nothing;

drop policy if exists ev_photos_storage on storage.objects;
create policy ev_photos_storage on storage.objects for all to authenticated
  using (
    bucket_id = 'ev-photos' and (
      public.ev_is_admin()
      or (storage.foldername(name))[1] in (select x::text from public.ev_my_student_ids() as x)
    )
  )
  with check (
    bucket_id = 'ev-photos' and (
      public.ev_is_admin()
      or (storage.foldername(name))[1] in (select x::text from public.ev_my_student_ids() as x)
    )
  );

-- 5. 강사 계정 등록 ------------------------------------------------------------
-- Authentication > Users 에서 강사 계정을 만든 뒤, 아래 이메일을 바꿔서 이 줄만 따로 실행하세요.
-- insert into public.ev_admins (user_id) select id from auth.users where email = '강사이메일@example.com';
