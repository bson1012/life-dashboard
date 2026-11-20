// 금액 입력 칸: 입력하는 동안 1,000 단위 쉼표를 찍어 보여 줍니다.
// value 와 onChange 는 쉼표 없는 숫자 문자열("300000")로 주고받으므로, 계산 코드는 그대로 씁니다.
export const digitsOnly = (s) => String(s ?? '').replace(/[^0-9]/g, '');
export const withCommas = (s) => {
  const d = digitsOnly(s);
  return d ? Number(d).toLocaleString('en-US') : '';
};

export default function MoneyInput({ value, onChange, className, placeholder, ariaLabel, ...rest }) {
  return (
    <input
      type="text"
      inputMode="numeric"
      className={className}
      placeholder={placeholder}
      aria-label={ariaLabel}
      value={withCommas(value)}
      onChange={(e) => onChange(digitsOnly(e.target.value))}
      {...rest}
    />
  );
}
