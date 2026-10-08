drop policy if exists "Signed-in users can view profiles" on public.profiles;
create policy "Users view own profile" on public.profiles for select to authenticated using (auth.uid() = id);