/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  // tsconfig.json is scoped for the Next.js build and explicitly excludes
  // __tests__/ and scripts/ (they shouldn't ship in the app bundle) — but
  // ts-jest reuses that same config by default, so it was running against a
  // program that excluded both the test files and the source files under
  // test (TS5011: "common source directory is ./__tests__", root cause of
  // every test in this repo failing to run at all, not just new ones).
  // tsconfig.jest.json extends the base config with the include/exclude
  // scope ts-jest actually needs.
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.jest.json' }],
  },
};
