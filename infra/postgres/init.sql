-- Runs once, when the volume is first initialised.
-- POSTGRES_DB creates the main database; the e2e suite needs its own.
CREATE DATABASE acceleratio_test OWNER acceleratio;
