// 카테고리 색의 한 곳. 홈 대시보드와 가계부(파이 차트, 내역 카테고리명)가 모두 이 함수를 씁니다.
// 색은 카테고리 이름마다 정해져 있어서, 달이나 금액 순서가 바뀌어도 같은 카테고리는 늘 같은 색입니다.
import { EXPENSE_TREE, INCOME_TREE, treeNames } from '../config/ledgerCategories';

// 홈 대시보드의 지출 원그래프와 같은 파스텔 팔레트 (8색)
export const PIE_COLORS = ['#f7c5d5', '#bfe8d2', '#c7d2fe', '#fde9a8', '#dccbf5', '#fcd5b5', '#bfe6f5', '#dfe3ea'];
const TEXT = '#3b3346'; // 파스텔 배경 위에서 읽기 쉬운 진한 글자색

// 대분류 순서(지출 → 수입)대로 색을 차례로 배정합니다. 같은 색이 이웃하지 않도록 순서대로 돕니다.
const ORDER = [...treeNames(EXPENSE_TREE), ...treeNames(INCOME_TREE)];

// 지출 대분류마다 정해 둔 색. 11개가 서로 겹치지 않게 골랐습니다.
const NAME_COLORS = {
  '식비': '#f7c5d5', // 분홍
  '주거/통신': '#c7d2fe', // 연보라
  '교통/차량': '#bfe6f5', // 하늘
  '생활': '#ffcfe6', // 밝은 핑크
  '의복/미용': '#dccbf5', // 라벤더
  '건강': '#bfe8d2', // 민트
  '문화/취미': '#fcd5b5', // 살구
  '육아': '#fde9a8', // 노랑
  '경조사/모임': '#e4f3b5', // 연두
  '금융': '#cfeeea', // 청록
  '기타 지출': '#dfe3ea', // 회색
};

// 목록에 없는 이름은 해시로 고릅니다.
function hashIndex(text) {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h;
}


// 수입 대분류: 채우지 않고 테두리(stroke)만 그립니다. 색은 지출 카테고리의 파스텔 색을 그대로 빌려 씁니다.
// 주수입=주거/통신, 부수입=생활, 저축/보험=건강, 기타 수입=육아 (지출 색과 같음)
const INCOME_STROKE = {
  '주수입': { line: '#c7d2fe', fg: '#4a4fa8' },
  '부수입': { line: '#ffcfe6', fg: '#a33a72' },
  '저축/보험': { line: '#bfe8d2', fg: '#2e7d55' },
  '기타 수입': { line: '#fde9a8', fg: '#8a6408' },
};

export function categoryColor(name) {
  const text0 = String(name ?? '');
  if (INCOME_STROKE[text0]) return { bg: 'transparent', fg: INCOME_STROKE[text0].fg, line: INCOME_STROKE[text0].line };
  const text = String(name ?? '');
  if (NAME_COLORS[text]) return { bg: NAME_COLORS[text], fg: TEXT };
  const idx = ORDER.indexOf(text);
  const i = idx >= 0 ? idx : hashIndex(text);
  return { bg: PIE_COLORS[i % PIE_COLORS.length], fg: TEXT };
}
