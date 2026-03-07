CREATE DATABASE scouting_platform_test OWNER scouting;

\connect scouting_platform_test

ALTER SCHEMA public OWNER TO scouting;
GRANT ALL ON SCHEMA public TO scouting;
