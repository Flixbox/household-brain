/* oxlint-disable eslint/sort-keys -- the rules are grouped by topic, each group under the comment that explains it */
import { defineConfig } from 'oxlint'

export default defineConfig({
  plugins: [
    'react',
    'typescript',
    'oxc',
    'unicorn',
    'promise',
    'jsdoc',
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
    // The code uses null for "nothing" throughout (Firestore stores null; `undefined` is banned by
    // `eslint/no-undefined`), so unicorn's ban on null would contradict that.
    'unicorn/no-null': 'off',
    // Calls nested four deep still read well (`expect(text(of(x)))`); five is where a name helps.
    'unicorn/max-nested-calls': ['error', { max: 4 }],
    // Its fix writes `x === undefined`, which `eslint/no-undefined` bans.
    'unicorn/no-typeof-undefined': 'off',
    // Its fix turns `async () => Promise.reject(…)` into a bare `throw`, which then has nothing to
    // await and fails `typescript/require-await` (#186).
    'unicorn/no-useless-promise-resolve-reject': 'off',
    // A catch variable named for what it is (`conflict`) reads better than `error`, and renaming it
    // to `error` shadows an outer `error`.
    'unicorn/catch-error-name': 'off',
    // Its fix turns `Array.from(list.values())` inside a `map` callback into a spread, which
    // `oxc/no-map-spread` then reports.
    'unicorn/prefer-spread': 'off',
    // Its fix deletes `export {}` from a declaration file, which turns `declare module 'bun'` from an
    // addition to Bun's types into a replacement of them.
    'unicorn/require-module-specifiers': 'off',
    // `(await read()).length` is clear; a throwaway variable for each of them reads worse.
    'unicorn/no-await-expression-member': 'off',
    // The reduce calls chain promises one after another, the idiom here: a loop with `await` in it is
    // what `eslint/no-await-in-loop` forbids.
    'unicorn/no-array-reduce': 'off',
    // A case listed before `default` keeps `typescript/switch-exhaustiveness-check` satisfied.
    'unicorn/no-useless-switch-case': 'off',
    // TypeScript's types already say what each parameter and result is; a tag for each would repeat
    // them. The jsdoc rules that check a comment's form stay on.
    'jsdoc/require-param': 'off',
    'jsdoc/require-returns': 'off',
    // `.then` is used on purpose where nothing waits for the result (fire and forget from a click or
    // an effect), and its callbacks there only have side effects, ending the chain.
    'promise/prefer-await-to-then': 'off',
    'promise/prefer-await-to-callbacks': 'off',
    'promise/always-return': 'off',
    // Callback APIs (Google's sign-in script, IndexedDB, timers) become promises only through `new Promise`.
    'promise/avoid-new': 'off',
    // `then(done, failed)` handles a failure of the promise itself, not of `done`; that is the point
    // where it is used, so it is neither a missing catch nor a `catch` to prefer.
    'promise/catch-or-return': ['error', { allowThen: true }],
    'promise/prefer-catch': 'off',
    // Components and their files are PascalCase (`ItemForm.tsx`), everything else kebab-case.
    'unicorn/filename-case': ['error', { cases: { kebabCase: true, pascalCase: true } }],
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
        // A config file is a list (this one most of all): its length is its content.
        'eslint/max-lines': 'off',
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
      // objects, so tests may cast (#68); the app's code may not. A test's helpers sit next to the
      // steps that use them, and a journey's code run in the browser (`page.evaluate`) must stay inside it.
      files: ['**/*.test.ts', 'tests/**', 'apps/web/e2e/**'],
      rules: {
        'unicorn/consistent-function-scoping': 'off',
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
    {
      // Command-line scripts end with an exit code that tells their caller (CI, a shell) how it went.
      files: ['apps/web/build.ts', 'packages/pwa/src/build.ts', 'packages/tooling/src/**'],
      rules: {
        'unicorn/no-process-exit': 'off',
      },
    },
  ],
})
