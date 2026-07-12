/**
 * Jest config for the behaviour-driven domain + lib test suites.
 *
 * These suites cover pure logic (no React Native imports) so they run fast in
 * CI and locally without a simulator. Component (RNTL) and end-to-end (Maestro)
 * layers are described in the plan and run on the iOS simulator CI job.
 */
// Pin the timezone so date/period math is deterministic across machines. The
// app derives periods from the device's local timezone; tests default to UTC
// unless the npm script already set one (see "test:tz" in package.json, which
// runs the recurring-day suite under fixed non-UTC zones to prove the
// local-day recurrence fix — assessment H3).
if (!process.env.TZ) process.env.TZ = 'UTC';

module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.steps.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'CommonJS',
          esModuleInterop: true,
          jsx: 'react-jsx',
          strict: true,
        },
      },
    ],
  },
  clearMocks: true,
};
