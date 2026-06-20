/**
 * Jest config for the behaviour-driven domain + lib test suites.
 *
 * These suites cover pure logic (no React Native imports) so they run fast in
 * CI and locally without a simulator. Component (RNTL) and end-to-end (Maestro)
 * layers are described in the plan and run on the iOS simulator CI job.
 */
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
