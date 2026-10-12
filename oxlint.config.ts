/* oxlint-disable eslint/sort-keys -- the rules are grouped by topic, each group under the comment that explains it */
import { defineConfig } from 'oxlint'

export default defineConfig({
  plugins: [
    'react',
    'typescript',
    'oxc',
    'import',
  ],
  jsPlugins: [
    '@stylistic/eslint-plugin',
  ],
  // Rules that need type information (oxlint-tsgolint, #167), for the CLI, editors and lint:fix alike.
  options: {
    maxWarnings: 0,
    // A disable comment that turns nothing off fails the lint, so stale ones don't pile up.
    reportUnusedDisableDirectives: 'error',
    typeAware: true,
  },
  categories: {
    correctness: 'error',
    nursery: 'error',
    pedantic: 'error',
    perf: 'error',
    restriction: 'error',
    style: 'error',
    suspicious: 'error',
  },
  rules: {
    // The type-aware require-await replaces the plain one: a function that returns a promise is
    // marked `async` (promise-function-async) even when it has nothing to await, which only the
    // type-aware rule allows.
    'eslint/require-await': 'off',
    // Deep `readonly` on every parameter (React props and library types included) is more ceremony
    // than protection here (owner's call, #168).
    'typescript/prefer-readonly-parameter-types': 'off',
    'react/rules-of-hooks': 'error',
    // Continuation lines of a comment stay lowercase
    'eslint/capitalized-comments': ['error', 'always', { 'ignoreConsecutiveComments': true }],
    // Router links (wouter) are styled like anchors
    'react/forbid-component-props': ['error', { 'forbid': [{ 'allowedFor': ['Link'], 'propName': 'className' }] }],
    // Fights no-import-type-side-effects; verbatimModuleSyntax already enforces correct type imports
    'import/consistent-type-specifier-style': 'off',
    // Members stay sorted; module order is left to the author
    'eslint/sort-imports': ['error', { 'ignoreDeclarationSort': true }],
    'react/only-export-components': [
      'warn',
      {
        allowConstantExport: true,
      },
    ],
    // Narrow with type guards instead of casting (#68)
    'typescript/consistent-type-assertions': ['error', { 'assertionStyle': 'never' }],
    // A package imports its own modules by its name, `@household-brain/entries/lib/…` (#77)
    'import/no-relative-parent-imports': 'error',
    // React Compiler memoises at build time (#69, #84): memoising by hand is banned.
    'eslint/no-restricted-imports': ['error', { 'paths': [{ 'importNames': ['useMemo', 'useCallback', 'memo'], 'message': "React Compiler memoises at build time (#69): don't memoise by hand.", 'name': 'react' }] }],
    // The automatic JSX runtime needs no React import
    'react/react-in-jsx-scope': 'off',
    // Components are arrow functions too (#67)
    'react/function-component-definition': ['error', { 'namedComponents': 'arrow-function', 'unnamedComponents': 'arrow-function' }],
    '@stylistic/indent': [
      'error',
      2,
    ],
    '@stylistic/quotes': [
      'error',
      'single',
      {
        avoidEscape: true,
      },
    ],
    '@stylistic/jsx-quotes': [
      'error',
      'prefer-double',
    ],
    '@stylistic/semi': [
      'error',
      'never',
    ],
    '@stylistic/comma-dangle': [
      'error',
      'always-multiline',
    ],
    '@stylistic/comma-spacing': 'error',
    '@stylistic/object-curly-spacing': [
      'error',
      'always',
    ],
    '@stylistic/array-bracket-spacing': [
      'error',
      'never',
    ],
    '@stylistic/arrow-parens': [
      'error',
      'as-needed',
    ],
    '@stylistic/arrow-spacing': 'error',
    '@stylistic/brace-style': [
      'error',
      '1tbs',
      {
        allowSingleLine: true,
      },
    ],
    '@stylistic/key-spacing': 'error',
    '@stylistic/keyword-spacing': 'error',
    '@stylistic/space-before-blocks': 'error',
    '@stylistic/space-infix-ops': 'error',
    '@stylistic/eol-last': 'error',
    '@stylistic/no-trailing-spaces': 'error',
    '@stylistic/no-multiple-empty-lines': [
      'error',
      {
        max: 1,
        maxEOF: 0,
      },
    ],
    '@stylistic/member-delimiter-style': [
      'error',
      {
        multiline: {
          delimiter: 'none',
        },
        singleline: {
          delimiter: 'comma',
          requireLast: false,
        },
      },
    ],
    '@stylistic/type-annotation-spacing': 'error',
    '@stylistic/jsx-indent-props': [
      'error',
      2,
    ],
    '@stylistic/jsx-closing-bracket-location': 'error',
    '@stylistic/jsx-self-closing-comp': 'error',
    // Type-only imports add no runtime coupling, so they don't count towards the limit.
    'import/max-dependencies': [
      'error',
      {
        ignoreTypeImports: true,
      },
    ],
    'import/no-unassigned-import': [
      'warn',
      {
        allow: [
          '**/*.css',
        ],
      },
    ],
    'no-restricted-globals': [
      'error',
      {
        message: 'Date is banned: use Temporal (see the code rules in .ai/AGENTS.md).',
        name: 'Date',
      },
    ],
    // Async/await is the normal way to write async code
    'oxc/no-async-await': 'off',
    // Object spread is standard since ES2018
    'oxc/no-rest-spread-properties': 'off',
    // Optional chaining is standard since ES2020
    'oxc/no-optional-chaining': 'off',
    // Named exports are the convention (conflicts with no-default-export)
    'import/no-named-export': 'off',
    // Conflicts with no-default-export
    'import/prefer-default-export': 'off',
    // Exports stay next to what they export
    'import/group-exports': 'off',
    // Exports stay next to what they export
    'import/exports-last': 'off',
    // No i18n layer, plain text in JSX is fine
    'react/jsx-no-literals': 'off',
    // Layout depth is a design choice, not a defect
    'react/jsx-max-depth': 'off',
    // TypeScript already checks undefined names
    'eslint/no-undef': 'off',
    // Arrow functions only, no `function` declarations (#67)
    'eslint/func-style': ['error', 'expression'],
    // One declaration per variable is clearer
    'eslint/one-var': 'off',
    // Too noisy for ports, sizes and timeouts
    'eslint/no-magic-numbers': 'off',
    // Ternaries are fine for simple branches
    'eslint/no-ternary': 'off',
    // Return types are inferred
    'typescript/explicit-function-return-type': 'off',
    // Return types are inferred
    'typescript/explicit-module-boundary-types': 'off',
    'react/jsx-filename-extension': [
      'error',
      {
        extensions: [
          '.tsx',
        ],
      },
    ],
    // Functions are arrow constants (#67): one may call another defined further down, as the call only
    // runs later. A direct top-level use before the definition is still reported, but not one through a
    // callback that runs at load (`[1].map(() => later())`): keep code that runs at load below what it uses.
    'eslint/no-use-before-define': [
      'error',
      {
        functions: false,
        variables: false,
      },
    ],
  },
  ignorePatterns: [
    'dist',
    'playwright-report',
    'test-results',
  ],
  overrides: [
    {
      // Bun:test types the `.rejects`/`.resolves` matchers as returning nothing, but they return a
      // promise that must be awaited, or the test ends before the assertion runs. And
      // `expect<unknown>(…)` (a loose comparison) only looks unneeded: `unknown` is the parameter's
      // default, but without it the type is inferred from the value instead.
      files: ['**/*.test.ts'],
      rules: {
        'typescript/await-thenable': 'off',
        'typescript/no-confusing-void-expression': 'off',
        'typescript/no-unnecessary-type-arguments': 'off',
      },
    },
    {
      files: [
        '**/*.config.ts',
        '**/playwright.config.ts',
      ],
      rules: {
        'import/no-default-export': 'off',
        'import/no-nodejs-modules': 'off',
      },
    },
    {
      files: [
        'tests/**',
        'apps/web/e2e/**',
      ],
      rules: {
        'import/no-nodejs-modules': 'off',
      },
    },
    {
      files: [
        '**/*.d.ts',
      ],
      rules: {
        'import/unambiguous': 'off',
      },
    },
    {
      // Test fakes implement async interfaces without needing to await anything, and a test is a
      // linear script: splitting it to satisfy size limits would hide the steps it checks. Fixtures
      // fill in only the fields a test is about, and fakes stand in for Google's and the browser's
      // objects, so tests may cast (#68); the app's code may not.
      files: ['**/*.test.ts', 'tests/**', 'apps/web/e2e/**'],
      rules: {
        'eslint/max-lines-per-function': 'off',
        'eslint/max-statements': 'off',
        'typescript/require-await': 'off',
        'typescript/consistent-type-assertions': 'off',
      },
    },
    {
      // E2e specs are a few long user journeys (one per area), so they may be long files.
      files: ['apps/web/e2e/**'],
      rules: {
        'eslint/max-lines': 'off',
      },
    },
  ],
})
