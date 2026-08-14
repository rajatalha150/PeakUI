-- Enable pgvector extension on fresh DB volumes.
-- The schema uses Unsupported("vector") columns; prisma db push does not
-- create extensions, so without this the app crash-loops with
-- `type "vector" does not exist`.
CREATE EXTENSION IF NOT EXISTS vector;
