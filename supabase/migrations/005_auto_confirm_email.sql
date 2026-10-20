-- 가입 시 이메일 인증을 생략한다(비밀번호 인증만 사용). 대시보드의 "Confirm email" 설정과 무관하게 동작한다.
create or replace function public.auto_confirm_email()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.email_confirmed_at := coalesce(new.email_confirmed_at, now());
  return new;
end;
$$;
revoke execute on function public.auto_confirm_email() from public, anon, authenticated;
create trigger auto_confirm_email
  before insert on auth.users
  for each row execute function public.auto_confirm_email();

-- 이미 가입했지만 인증 대기 중인 계정도 인증 처리한다.
update auth.users set email_confirmed_at = now() where email_confirmed_at is null;
