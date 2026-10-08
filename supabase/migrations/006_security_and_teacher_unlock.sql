-- Security hardening + teacher unlock for proctoring bans
-- Run in Supabase SQL Editor after prior migrations.

-- Prevent users from self-approving or changing their own role via RLS update policy
create or replace function public.prevent_user_self_privilege_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and auth.uid() = old.id and not public.is_admin() then
    if new.role is distinct from old.role then
      raise exception 'You cannot change your own role';
    end if;
    if new.is_approved is distinct from old.is_approved then
      raise exception 'You cannot change your own approval status';
    end if;
    if new.staff_id is distinct from old.staff_id and old.role in ('teacher', 'admin') then
      raise exception 'You cannot change staff identifiers';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_users_no_self_escalation on public.users;
create trigger trg_users_no_self_escalation
  before update on public.users
  for each row execute function public.prevent_user_self_privilege_escalation();

-- Teachers may unlock students banned from exams they created
create or replace function public.teacher_unlock_student(
  p_student_id uuid,
  p_exam_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_admin() then
    return public.admin_unlock_student(p_student_id, p_exam_id);
  end if;

  if not public.is_teacher() then
    raise exception 'Teacher or admin only';
  end if;

  if not exists (
    select 1 from public.exams e
    where e.id = p_exam_id and e.created_by = auth.uid()
  ) then
    raise exception 'You can only unlock students for your own exams';
  end if;

  update public.locks
  set
    is_locked = false,
    unlocked_by = auth.uid(),
    unlocked_at = now()
  where student_id = p_student_id
    and exam_id = p_exam_id
    and is_locked = true;

  return found;
end;
$$;

grant execute on function public.teacher_unlock_student(uuid, uuid) to authenticated;
