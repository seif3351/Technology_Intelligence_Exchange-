-- Local/test convenience: a separate database for integration tests.
CREATE DATABASE atx_test OWNER atx;
\c atx_test
CREATE EXTENSION IF NOT EXISTS vector;
\c atx
CREATE EXTENSION IF NOT EXISTS vector;
