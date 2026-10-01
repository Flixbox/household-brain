// Lints package.json (npm-package-json-lint). Every dependency must be pinned to an exact version;
// pnpm-workspace.yaml sets savePrefix '' so `pnpm add` writes exact versions, and Dependabot bumps them.
// The linter `require()`s this file, which Node loads as an ES module, so it reads the module's
// named exports: `rules` must be a named export (a default export would arrive as `{ default }`).
export const rules = {
  'prefer-absolute-version-dependencies': 'error',
  'prefer-absolute-version-devDependencies': 'error',
  'no-archive-dependencies': 'error',
  'no-archive-devDependencies': 'error',
  'no-git-dependencies': 'error',
  'no-git-devDependencies': 'error',
  'no-file-dependencies': 'error',
  'no-file-devDependencies': 'error',
  'no-repeated-dependencies': 'error',
  'no-duplicate-properties': 'error',
  'prefer-alphabetical-dependencies': 'error',
  'prefer-alphabetical-devDependencies': 'error',
  'require-name': 'error',
  'require-license': 'error',
  'require-type': 'error',
  'valid-values-private': ['error', [true]],
}
