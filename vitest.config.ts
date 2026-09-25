import { configDefaults, defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`.
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
    // vitest globs dot-directories, so without this a run from the main
    // checkout also collects every Claude Code worktree under .claude/.
    exclude: [...configDefaults.exclude, '.claude/**'],
  },
});
