CREATE SCHEMA IF NOT EXISTS todo2;
GRANT ALL ON SCHEMA todo2 TO appuser;
ALTER ROLE appuser SET search_path = todo2;
