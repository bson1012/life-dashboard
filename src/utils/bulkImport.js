// 일괄 추가: 엑셀·시트에서 복사한 표(탭 또는 쉼표 구분)를 가계부 거래 목록으로 읽습니다.
// 열 순서: 날짜 · 타입(지출/수입/이체) · 사용처 · 금액 · 화폐 · 결제수단
// 첫 줄이 "날짜"로 시작하면 머리글로 보고 열 이름으로 찾습니다.
// 이체는 우리 시스템의 "이동"(계좌 간 이동)으로 저장합니다. 받는 계좌는 표에 없으므로 미리보기에서 고릅니다.

const TYPE_MAP = { 지출: 'expense', 이체: 'transfer', 수입: 'income' };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 한 줄을 칸으로 나눕니다. 큰따옴표로 감싼 칸 안의 쉼표·탭은 구분자로 보지 않습니다.
function splitLine(line) {
  const sep = line.includes('\t') ? '\t' : ',';
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (ch === sep && !quoted) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

const isValidDate = (s) => {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
};

// 붙여넣은 글을 행 목록으로 바꿉니다. 문제가 있는 행은 error 에 이유를 담아 둡니다.
// payments: 결제수단 목록(이름으로 찾습니다).
export function parseBulk(text, payments) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  let rows = lines.map(splitLine);
  let col = { date: 0, type: 1, merchant: 2, amount: 3, currency: 4, payment: 5 };
  let offset = 1; // 화면에 보일 줄 번호 시작값
  if (rows[0] && rows[0][0] === '날짜') {
    const head = rows[0];
    const find = (name, fallback) => {
      const i = head.indexOf(name);
      return i >= 0 ? i : fallback;
    };
    col = {
      date: find('날짜', 0),
      type: find('타입', 1),
      merchant: find('사용처', 2),
      amount: find('금액', 3),
      currency: find('화폐', 4),
      payment: find('결제수단', 5),
    };
    rows = rows.slice(1);
    offset = 2;
  }

  const byName = new Map(payments.map((p) => [p.name.trim(), p]));

  return rows.map((cells, i) => {
    const pick = (k) => (cells[col[k]] ?? '').trim();
    const row = {
      no: i + offset,
      date: pick('date'),
      rawType: pick('type'),
      type: TYPE_MAP[pick('type')] ?? null,
      merchant: pick('merchant'),
      amount: 0,
      paymentName: pick('payment'),
      paymentId: '',
      error: '',
    };
    const currency = pick('currency');
    const amountN = Math.abs(Number(pick('amount').replace(/[,\s원]/g, '')));

    if (!isValidDate(row.date)) row.error = '날짜 형식이 맞지 않아요 (2026-11-20)';
    else if (!row.type) row.error = `타입을 알 수 없어요 (${row.rawType})`;
    else if (!(amountN > 0) || !Number.isInteger(amountN)) row.error = '금액이 올바르지 않아요';
    else if (currency && currency !== 'KRW') row.error = `원화(KRW)만 넣을 수 있어요 (${currency})`;
    else if (!byName.has(row.paymentName)) row.error = `결제수단을 찾을 수 없어요 (${row.paymentName})`;
    else row.paymentId = byName.get(row.paymentName).id;
    row.amount = amountN;
    return row;
  });
}
