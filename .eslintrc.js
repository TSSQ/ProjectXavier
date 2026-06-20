module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2021,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  env: { node: true, es2021: true, jest: true },
  ignorePatterns: [
    'node_modules/',
    'dist/',
    '.expo/',
    'babel.config.js',
    // Supabase Edge Functions are Deno (npm: imports + Deno globals), not part
    // of the app's Node/TS build — linted/typechecked by the Supabase toolchain.
    'supabase/',
  ],
  rules: {
    // App/runtime globals (fetch, console, etc.) and JSX are validated by the
    // TypeScript compiler, so disable the redundant/slow eslint checks here.
    'no-undef': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-non-null-assertion': 'off',
    'no-empty': ['error', { allowEmptyCatch: true }],
  },
};
