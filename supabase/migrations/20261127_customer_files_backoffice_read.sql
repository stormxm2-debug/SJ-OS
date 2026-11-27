-- 총무비서가 FC 고객 첨부(신분증·서류 사진 등)를 열람할 수 있게 한다 (대표 지시 2026-11-27:
-- "총무 아이디에서는 모든 FC 정보 다 볼 수 있게"). 읽기만 — 업로드·수정·삭제 권한은 그대로.
drop policy if exists customer_files_backoffice_read on storage.objects;
create policy customer_files_backoffice_read on storage.objects
  for select to authenticated
  using (bucket_id = 'customer-files' and public.is_backoffice());
