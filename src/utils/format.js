export const pad = (n) => String(n).padStart(2, '0');

export const toDateStr = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const toDateTimeStr = (d) =>
  `${toDateStr(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

export const todayStr = () => toDateStr(new Date());

export const monthStr = (d = new Date()) => toDateStr(d).slice(0, 7);

export const shiftMonth = (ym, delta) => {
  const [y, m] = ym.split('-').map(Number);
  return monthStr(new Date(y, m - 1 + delta, 1));
};

export const formatWon = (n) => `${Number(n || 0).toLocaleString('ko-KR')}원`;

export const formatMonthLabel = (ym) => {
  const [y, m] = ym.split('-');
  return `${y}년 ${Number(m)}월`;
};

export const shiftDateTime = (str, repeat) => {
  const d = new Date(str);
  d.setDate(d.getDate() + (repeat === 'weekly' ? 7 : 1));
  return toDateTimeStr(d);
};

export const formatDateTime = (str) => {
  if (!str) return '';
  const d = new Date(str);
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
