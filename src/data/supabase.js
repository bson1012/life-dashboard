// Supabase 클라이언트. 환경 변수가 없으면 null 을 돌려주고, 앱은 이 기기 안에서만(localStorage) 동작합니다.
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
// Supabase 가 새로 만든 키 이름(publishable)과 예전 이름(anon) 중 있는 쪽을 씁니다.
// 빈 문자열("")도 없는 것으로 봐야 해서 ?? 가 아니라 || 를 씁니다. (GitHub Secrets 가 없으면 빈 값으로 들어옵니다)
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// npm run dev(로컬 개발)에서는 Supabase 를 쓰지 않고 이 기기의 localStorage 만 씁니다.
// 배포된 페이지(빌드)에서만 Supabase 에 연결합니다.
export const supabase = !import.meta.env.DEV && url && anonKey ? createClient(url, anonKey) : null;
