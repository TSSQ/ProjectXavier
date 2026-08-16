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
    // Design handoff HTML prototypes — not part of the app build.
    'design_handoff_keyboard_avoidance/',
    'design_handoff_xavier_avatar/',
    'design_handoff_responsive_scaling/',
  ],
  rules: {
    // App/runtime globals (fetch, console, etc.) and JSX are validated by the
    // TypeScript compiler, so disable the redundant/slow eslint checks here.
    'no-undef': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-non-null-assertion': 'off',
    'no-empty': ['error', { allowEmptyCatch: true }],
    // NativeWind's cssInterop wraps Pressable (so `className` works) and
    // SWALLOWS the function form of `style` — every declaration inside it is
    // silently dropped, with no warning and no crash. It has shipped broken
    // twice now: AmountKeypad (keys lost their size and surface) and the
    // long-press ContextMenu in build 60 (the row lost flexDirection/padding
    // and rendered as a stacked, overflowing column). That component has since
    // been deleted — swipe-left replaced it — but the failure mode is the
    // reason this rule exists, so the history stays. Failure is invisible in
    // tests and in typecheck — only on device — so it's a lint error.
    // Fix: use a plain object `style` and drive pressed state from useState via
    // onPressIn/onPressOut.
    'no-restricted-syntax': [
      'error',
      {
        selector:
          "JSXAttribute[name.name='style'] > JSXExpressionContainer > ArrowFunctionExpression",
        message:
          "Function-form `style` is swallowed by NativeWind's cssInterop and silently does nothing. Use a plain object style; for press feedback use useState + onPressIn/onPressOut (see src/components/ui/SwipeableRow.tsx).",
      },
    ],
  },
};
