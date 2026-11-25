import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    tailwindcss(),
    svelte(),
  ],
  test: {
    environment: 'jsdom',
    // 作業用の git worktree が .claude/ の下に置かれるので、その中のテスト
    // ファイルまで拾わないようにする（拾うと同じテストが二重に走る）。
    exclude: ['node_modules/**', 'dist/**', '.claude/**'],
  },
})
