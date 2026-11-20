import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// GitHub Pages 주소는 https://<사용자>.github.io/<저장소 이름>/ 형태라서 base 를 맞춰야 합니다.
// GitHub Actions 에서는 GITHUB_REPOSITORY(예: 사용자/저장소)가 자동으로 들어옵니다.
// 저장소 이름이 <사용자>.github.io 이면 주소가 루트이므로 base 는 '/' 입니다.
const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1]
const base = repoName && !repoName.endsWith('.github.io') ? `/${repoName}/` : '/'

// https://vite.dev/config/
export default defineConfig({
  base,
  plugins: [react()],
})
