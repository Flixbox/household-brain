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
    'eslint-plugin-playwright',
    'eslint-plugin-regexp',
    'eslint-plugin-sonarjs',
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
    // SonarJS's checks (#187): likely bugs (identical branches, conditions always true, ignored results)
    // and complexity, as a guardrail against sprawling code. Its recommended set, but for the rules below.
    // Under `exactOptionalPropertyTypes`, `?: string | undefined` says something `?: string` doesn't.
    'sonarjs/no-redundant-optional': 'off',
    // The `no-unused-vars` of oxlint itself has this covered, and SonarJS's flags the `{ id: _id, ...rest }`
    // way of leaving a property out.
    'sonarjs/no-unused-vars': 'off',
    // Backtracking is `regexp/no-super-linear-backtracking`'s; what this one adds is a search that
    // restarts at each position, which only slows down on long pathological input, and these patterns
    // only see one event's description or one link.
    'sonarjs/super-linear-regex': 'off',
    'sonarjs/class-name': 'error',
    'sonarjs/no-fallthrough': 'error',
    'sonarjs/no-equals-in-for-termination': 'error',
    'sonarjs/no-extra-arguments': 'error',
    'sonarjs/no-labels': 'error',
    'sonarjs/no-nested-assignment': 'error',
    'sonarjs/no-redundant-boolean': 'error',
    'sonarjs/prefer-single-boolean-return': 'error',
    'sonarjs/unused-import': 'error',
    'sonarjs/fixme-tag': 'error',
    'sonarjs/todo-tag': 'error',
    'sonarjs/no-case-label-in-switch': 'error',
    'sonarjs/no-parameter-reassignment': 'error',
    'sonarjs/no-floating-point-equality': 'error',
    'sonarjs/prefer-while': 'error',
    'sonarjs/no-small-switch': 'error',
    'sonarjs/no-hardcoded-ip': 'error',
    'sonarjs/label-position': 'error',
    'sonarjs/public-static-readonly': 'error',
    'sonarjs/call-argument-line': 'error',
    'sonarjs/max-switch-cases': 'error',
    'sonarjs/function-inside-loop': 'error',
    'sonarjs/code-eval': 'error',
    'sonarjs/future-reserved-words': 'error',
    'sonarjs/bitwise-operators': 'error',
    'sonarjs/no-primitive-wrappers': 'error',
    'sonarjs/no-skipped-tests': 'error',
    'sonarjs/no-identical-expressions': 'error',
    'sonarjs/constructor-for-side-effects': 'error',
    'sonarjs/no-dead-store': 'error',
    'sonarjs/no-identical-conditions': 'error',
    'sonarjs/no-duplicated-branches': 'error',
    'sonarjs/deprecation': 'error',
    'sonarjs/no-inverted-boolean-check': 'error',
    'sonarjs/misplaced-loop-counter': 'error',
    'sonarjs/no-nested-functions': 'error',
    'sonarjs/no-hardcoded-passwords': 'error',
    'sonarjs/sql-queries': 'error',
    'sonarjs/insecure-cookie': 'error',
    'sonarjs/no-useless-increment': 'error',
    'sonarjs/no-globals-shadowing': 'error',
    'sonarjs/no-empty-test-file': 'error',
    'sonarjs/no-ignored-return': 'error',
    'sonarjs/arguments-order': 'error',
    'sonarjs/pseudo-random': 'error',
    'sonarjs/for-loop-increment-sign': 'error',
    'sonarjs/null-dereference': 'error',
    'sonarjs/no-selector-parameter': 'error',
    'sonarjs/updated-loop-counter': 'error',
    'sonarjs/block-scoped-var': 'error',
    'sonarjs/no-ignored-exceptions': 'error',
    'sonarjs/no-gratuitous-expressions': 'error',
    'sonarjs/file-uploads': 'error',
    'sonarjs/file-permissions': 'error',
    'sonarjs/no-empty-character-class': 'error',
    'sonarjs/no-unenclosed-multiline-block': 'error',
    'sonarjs/index-of-compare-to-positive-number': 'error',
    'sonarjs/assertions-in-tests': 'error',
    'sonarjs/no-implicit-global': 'error',
    'sonarjs/no-useless-catch': 'error',
    'sonarjs/xml-parser-xxe': 'error',
    'sonarjs/non-existent-operator': 'error',
    'sonarjs/post-message': 'error',
    'sonarjs/no-array-delete': 'error',
    'sonarjs/no-alphabetical-sort': 'error',
    'sonarjs/no-fixed-wait-in-tests': 'error',
    'sonarjs/no-incomplete-assertions': 'error',
    'sonarjs/no-global-this': 'error',
    'sonarjs/new-operator-misuse': 'error',
    'sonarjs/no-delete-var': 'error',
    'sonarjs/cookie-no-httponly': 'error',
    'sonarjs/no-nested-conditional': 'error',
    'sonarjs/different-types-comparison': 'error',
    'sonarjs/inverted-assertion-arguments': 'error',
    'sonarjs/updated-const-var': 'error',
    'sonarjs/no-invariant-returns': 'error',
    'sonarjs/generator-without-yield': 'error',
    'sonarjs/no-associative-arrays': 'error',
    'sonarjs/comma-or-logical-or-case': 'error',
    'sonarjs/no-redundant-jump': 'error',
    'sonarjs/inconsistent-function-call': 'error',
    'sonarjs/no-use-of-empty-return-value': 'error',
    'sonarjs/void-use': 'error',
    'sonarjs/cognitive-complexity': 'error',
    'sonarjs/argument-type': 'error',
    'sonarjs/in-operator-type-error': 'error',
    'sonarjs/array-callback-without-return': 'error',
    'sonarjs/function-return-type': 'error',
    'sonarjs/no-all-duplicated-branches': 'error',
    'sonarjs/no-same-line-conditional': 'error',
    'sonarjs/no-collection-size-mischeck': 'error',
    'sonarjs/no-unthrown-error': 'error',
    'sonarjs/no-unused-collection': 'error',
    'sonarjs/no-os-command-from-path': 'error',
    'sonarjs/no-misleading-array-reverse': 'error',
    'sonarjs/no-element-overwrite': 'error',
    'sonarjs/no-identical-functions': 'error',
    'sonarjs/no-empty-collection': 'error',
    'sonarjs/no-redundant-assignments': 'error',
    'sonarjs/prefer-type-guard': 'error',
    'sonarjs/use-type-alias': 'error',
    'sonarjs/no-useless-intersection': 'error',
    'sonarjs/weak-ssl': 'error',
    'sonarjs/no-weak-keys': 'error',
    'sonarjs/csrf': 'error',
    'sonarjs/production-debug': 'error',
    'sonarjs/prefer-default-last': 'error',
    'sonarjs/no-in-misuse': 'error',
    'sonarjs/no-duplicate-in-composite': 'error',
    'sonarjs/no-undefined-argument': 'error',
    'sonarjs/no-nested-template-literals': 'error',
    'sonarjs/prefer-promise-shorthand': 'error',
    'sonarjs/hashing': 'error',
    'sonarjs/no-try-promise': 'error',
    'sonarjs/unverified-certificate': 'error',
    'sonarjs/cors': 'error',
    'sonarjs/link-with-target-blank': 'error',
    'sonarjs/disabled-auto-escaping': 'error',
    'sonarjs/table-header': 'error',
    'sonarjs/no-table-as-layout': 'error',
    'sonarjs/table-header-reference': 'error',
    'sonarjs/object-alt-content': 'error',
    'sonarjs/no-clear-text-protocols': 'error',
    'sonarjs/publicly-writable-directories': 'error',
    'sonarjs/unverified-hostname': 'error',
    'sonarjs/encryption-secure-mode': 'error',
    'sonarjs/no-weak-cipher': 'error',
    'sonarjs/insecure-jwt-token': 'error',
    'sonarjs/x-powered-by': 'error',
    'sonarjs/content-length': 'error',
    'sonarjs/disabled-resource-integrity': 'error',
    'sonarjs/content-security-policy': 'error',
    'sonarjs/no-mime-sniff': 'error',
    'sonarjs/no-referrer-policy': 'error',
    'sonarjs/strict-transport-security': 'error',
    'sonarjs/empty-string-repetition': 'error',
    'sonarjs/regex-complexity': 'error',
    'sonarjs/no-incompatible-assertion-types': 'error',
    'sonarjs/anchor-precedence': 'error',
    'sonarjs/slow-regex': 'error',
    'sonarjs/no-invalid-regexp': 'error',
    'sonarjs/unused-named-groups': 'error',
    'sonarjs/no-same-argument-assert': 'error',
    'sonarjs/no-misleading-character-class': 'error',
    'sonarjs/duplicates-in-character-class': 'error',
    'sonarjs/session-regeneration': 'error',
    'sonarjs/prefer-specific-assertions': 'error',
    'sonarjs/no-trivial-assertions': 'error',
    'sonarjs/test-check-exception': 'error',
    'sonarjs/stable-tests': 'error',
    'sonarjs/parameterized-tests': 'error',
    'sonarjs/no-empty-after-reluctant': 'error',
    'sonarjs/single-character-alternation': 'error',
    'sonarjs/no-code-after-done': 'error',
    'sonarjs/disabled-timeout': 'error',
    'sonarjs/chai-determinate-assertion': 'error',
    'sonarjs/aws-s3-bucket-insecure-http': 'error',
    'sonarjs/aws-s3-bucket-versioning': 'error',
    'sonarjs/aws-s3-bucket-granted-access': 'error',
    'sonarjs/no-angular-bypass-sanitization': 'error',
    'sonarjs/aws-iam-public-access': 'error',
    'sonarjs/aws-ec2-unencrypted-ebs-volume': 'error',
    'sonarjs/aws-s3-bucket-public-access': 'error',
    'sonarjs/aws-iam-all-privileges': 'error',
    'sonarjs/aws-rds-unencrypted-databases': 'error',
    'sonarjs/aws-opensearchservice-domain': 'error',
    'sonarjs/aws-iam-privilege-escalation': 'error',
    'sonarjs/aws-sagemaker-unencrypted-notebook': 'error',
    'sonarjs/aws-restricted-ip-admin-access': 'error',
    'sonarjs/no-empty-alternatives': 'error',
    'sonarjs/no-control-regex': 'error',
    'sonarjs/no-regex-spaces': 'error',
    'sonarjs/aws-sns-unencrypted-topics': 'error',
    'sonarjs/existing-groups': 'error',
    'sonarjs/aws-ec2-rds-dms-public': 'error',
    'sonarjs/aws-sqs-unencrypted-queue': 'error',
    'sonarjs/no-empty-group': 'error',
    'sonarjs/aws-efs-unencrypted': 'error',
    'sonarjs/aws-apigateway-public-api': 'error',
    'sonarjs/stateful-regex': 'error',
    'sonarjs/concise-regex': 'error',
    'sonarjs/single-char-in-character-classes': 'error',
    'sonarjs/no-hardcoded-secrets': 'error',
    'sonarjs/no-exclusive-tests': 'error',
    'sonarjs/hardcoded-secret-signatures': 'error',
    'sonarjs/jsx-no-leaked-render': 'error',
    'sonarjs/no-hook-setter-in-body': 'error',
    'sonarjs/no-useless-react-setstate': 'error',
    'sonarjs/no-uniq-key': 'error',
    'sonarjs/redundant-type-aliases': 'error',
    'sonarjs/prefer-regexp-exec': 'error',
    'sonarjs/no-internal-api-use': 'error',
    'sonarjs/prefer-read-only-props': 'error',
    'sonarjs/no-literal-call': 'error',
    'sonarjs/reduce-initial-value': 'error',
    'sonarjs/no-async-constructor': 'error',
    'sonarjs/review-blockchain-mnemonic': 'error',
    'sonarjs/dynamically-constructed-templates': 'error',
    'sonarjs/no-session-cookies-on-static-assets': 'error',
    'sonarjs/dompurify-unsafe-config': 'error',
    'sonarjs/no-duplicate-test-title': 'error',
    'sonarjs/async-test-assertions': 'error',
    'sonarjs/no-empty-test-title': 'error',
    'sonarjs/hooks-before-test-cases': 'error',
    'sonarjs/no-forced-browser-interaction': 'error',
    'sonarjs/assertions-in-test-cases': 'error',
    'sonarjs/synchronous-suite-callback': 'error',
    'sonarjs/prefer-native-lodash-alternative': 'error',
    'sonarjs/no-default-utility-imports': 'error',
    'sonarjs/memoize-cache-key': 'error',
    'sonarjs/no-debug-commands-in-ui-tests': 'error',
    'sonarjs/no-interpolation-in-inline-snapshots': 'error',
    'sonarjs/explicit-test-skip': 'error',
    'sonarjs/no-empty-parameterized-test-dataset': 'error',
    'sonarjs/testing-library-query-assertion': 'error',
    'sonarjs/synchronous-exception-assertions': 'error',
    'sonarjs/no-duplicate-parameterized-test-case': 'error',
    'sonarjs/no-debounce-throttle-in-render': 'error',
    'sonarjs/avoid-mutating-nested-properties-of-shallow-clones': 'error',
    'sonarjs/prefer-native-jquery-alternative': 'error',
    'sonarjs/no-vue-class-component': 'error',
    'sonarjs/no-vue-mixins': 'error',
    'sonarjs/testing-library-prefer-query-by-disappearance': 'error',
    'sonarjs/prefer-cypress-should': 'error',
    'sonarjs/no-mutate-reactive-state-in-updated-hook': 'error',
    'sonarjs/vitest-mock-at-module-scope': 'error',
    'sonarjs/prefer-native-axios-alternative': 'error',
    // Regular expressions checked for what they actually match (#187): backtracking that can hang,
    // ranges and escapes that mean something else, unused groups. The plugin's recommended set.
    'regexp/confusing-quantifier': 'error',
    'regexp/control-character-escape': 'error',
    'regexp/match-any': 'error',
    'regexp/negation': 'error',
    'regexp/no-contradiction-with-assertion': 'error',
    'regexp/no-dupe-characters-character-class': 'error',
    'regexp/no-dupe-disjunctions': 'error',
    'regexp/no-empty-alternative': 'error',
    'regexp/no-empty-capturing-group': 'error',
    'regexp/no-empty-character-class': 'error',
    'regexp/no-empty-group': 'error',
    'regexp/no-empty-lookarounds-assertion': 'error',
    'regexp/no-empty-string-literal': 'error',
    'regexp/no-escape-backspace': 'error',
    'regexp/no-extra-lookaround-assertions': 'error',
    'regexp/no-invalid-regexp': 'error',
    'regexp/no-invisible-character': 'error',
    'regexp/no-lazy-ends': 'error',
    'regexp/no-legacy-features': 'error',
    'regexp/no-misleading-capturing-group': 'error',
    'regexp/no-misleading-unicode-character': 'error',
    'regexp/no-missing-g-flag': 'error',
    'regexp/no-non-standard-flag': 'error',
    'regexp/no-obscure-range': 'error',
    'regexp/no-optional-assertion': 'error',
    'regexp/no-potentially-useless-backreference': 'error',
    'regexp/no-super-linear-backtracking': 'error',
    'regexp/no-trivially-nested-assertion': 'error',
    'regexp/no-trivially-nested-quantifier': 'error',
    'regexp/no-unused-capturing-group': 'error',
    'regexp/no-useless-assertions': 'error',
    'regexp/no-useless-backreference': 'error',
    'regexp/no-useless-character-class': 'error',
    'regexp/no-useless-dollar-replacements': 'error',
    'regexp/no-useless-escape': 'error',
    'regexp/no-useless-flag': 'error',
    'regexp/no-useless-lazy': 'error',
    'regexp/no-useless-non-capturing-group': 'error',
    'regexp/no-useless-quantifier': 'error',
    'regexp/no-useless-range': 'error',
    'regexp/no-useless-set-operand': 'error',
    'regexp/no-useless-string-literal': 'error',
    'regexp/no-useless-two-nums-quantifier': 'error',
    'regexp/no-zero-quantifier': 'error',
    'regexp/optimal-lookaround-quantifier': 'error',
    'regexp/optimal-quantifier-concatenation': 'error',
    'regexp/prefer-character-class': 'error',
    'regexp/prefer-d': 'error',
    'regexp/prefer-plus-quantifier': 'error',
    'regexp/prefer-predefined-assertion': 'error',
    'regexp/prefer-question-quantifier': 'error',
    'regexp/prefer-range': 'error',
    'regexp/prefer-set-operation': 'error',
    'regexp/prefer-star-quantifier': 'error',
    'regexp/prefer-unicode-codepoint-escapes': 'error',
    'regexp/prefer-w': 'error',
    'regexp/simplify-set-operations': 'error',
    'regexp/sort-flags': 'error',
    'regexp/strict': 'error',
    'regexp/use-ignore-case': 'error',
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
        // The rules tests assert through Firebase's `assertSucceeds` / `assertFails`, which SonarJS
        // doesn't know; test data has plain `http://` addresses on purpose (link parsing); code run
        // in the browser through `page.evaluate` nests as deep as it has to; and a fake of Google's
        // API branches as much as the API does.
        'sonarjs/assertions-in-tests': 'off',
        'sonarjs/no-clear-text-protocols': 'off',
        'sonarjs/no-nested-functions': 'off',
        'sonarjs/cognitive-complexity': 'off',
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
        // Playwright's own checks (#187): missing awaits on its async calls, fixed waits, focused or
        // skipped tests, assertions that don't retry. The plugin's recommended set, all as errors.
        'playwright/consistent-spacing-between-blocks': 'error',
        'playwright/expect-expect': 'error',
        'playwright/max-nested-describe': 'error',
        'playwright/missing-playwright-await': 'error',
        'playwright/no-conditional-expect': 'error',
        // The ifs in the journeys are guards that narrow a value before use (`if (!box) throw …`), and
        // one step that unfolds a section only on the devices where an earlier tap folded it.
        'playwright/no-conditional-in-test': 'off',
        'playwright/no-duplicate-hooks': 'error',
        'playwright/no-duplicate-slow': 'error',
        'playwright/no-element-handle': 'error',
        'playwright/no-eval': 'error',
        'playwright/no-focused-test': 'error',
        'playwright/no-force-option': 'error',
        'playwright/no-identical-title': 'error',
        // A sub-step uses its step's locators (`toggle`, `coupons`); flattening would move them up into
        // the whole journey, out of the step they belong to.
        'playwright/no-nested-step': 'off',
        'playwright/no-networkidle': 'error',
        'playwright/no-page-pause': 'error',
        // A journey that only one device can run skips the others with a reason; a bare skip still fails.
        'playwright/no-skipped-test': ['error', { allowConditional: true }],
        'playwright/no-standalone-expect': 'error',
        'playwright/no-unnecessary-assertions': 'error',
        'playwright/no-unsafe-references': 'error',
        'playwright/no-unused-locators': 'error',
        'playwright/no-useless-await': 'error',
        'playwright/no-useless-not': 'error',
        'playwright/no-wait-for-navigation': 'error',
        'playwright/no-wait-for-selector': 'error',
        'playwright/no-wait-for-timeout': 'error',
        'playwright/prefer-hooks-in-order': 'error',
        'playwright/prefer-hooks-on-top': 'error',
        'playwright/prefer-locator': 'error',
        'playwright/prefer-to-have-count': 'error',
        'playwright/prefer-to-have-length': 'error',
        'playwright/prefer-web-first-assertions': 'error',
        'playwright/valid-describe-callback': 'error',
        'playwright/valid-expect': 'error',
        'playwright/valid-expect-in-promise': 'error',
        'playwright/valid-test-tags': 'error',
        'playwright/valid-title': 'error',
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
