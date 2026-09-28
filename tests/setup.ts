import '@testing-library/jest-dom/vitest';

/**
 * Defaults for tests that construct the environment. Integration tests override DATABASE_URL to
 * point at the dedicated test database before importing anything that reads it.
 */
process.env.SESSION_SECRET ??= 'test-session-secret-at-least-32-characters-long';
process.env.IP_HASH_PEPPER ??= 'test-pepper';
process.env.DATABASE_URL ??=
  process.env.DATABASE_URL_TEST ?? 'postgresql://postgres@localhost:55432/rfpi_test?host=/tmp';
