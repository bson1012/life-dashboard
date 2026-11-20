// Supabase 클라이언트. 환경 변수가 없으면 null 을 돌려주고, 앱은 이 기기 안에서만(localStorage) 동작합니다.
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = url && anonKey ? createClient(url, anonKey) : null;
