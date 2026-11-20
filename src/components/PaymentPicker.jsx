import { useState } from 'react';
import { KIND_LABEL } from '../config/payments';
import './PaymentPicker.css';

// 결제수단 검색 입력. 띄어쓰기로 나눈 키워드가 모두 들어간 항목을 보여줍니다.
// 이름과 종류(예: 카드, 체크, 현금)를 함께 검색합니다.
// 키보드: ↑↓ 이동, Enter 선택, Esc 닫기.
export default function PaymentPicker({ options, value, onChange }) {
  const selected = options.find((o) => o.id === value);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = options.filter((o) => {
    const hay = `${o.name} ${KIND_LABEL[o.kind] ?? ''}`.toLowerCase();
    return tokens.every((t) => hay.includes(t));
  });

  function openList() {
    setOpen(true);
    setQuery('');
    setActive(0);
  }

  function pick(o) {
    onChange(o.id);
    setOpen(false);
    setQuery('');
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      setOpen(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) openList();
      setActive((a) => Math.min(a + 1, Math.max(matches.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter' && open && matches[active]) {
      // 목록이 열려 있으면 Enter는 선택만 하고 폼 제출은 막습니다.
      e.preventDefault();
      pick(matches[active]);
    }
  }

  return (
    <div className="payment-picker">
      <input
        role="combobox"
        aria-label="결제수단"
        aria-expanded={open}
        placeholder="결제수단 검색"
        autoComplete="off"
        value={open ? query : (selected?.name ?? '')}
        onFocus={openList}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      {open && (
        <ul className="combo-list" role="listbox">
          {matches.length === 0 && <li className="combo-empty">검색 결과가 없어요</li>}
          {matches.map((o, i) => (
            <li
              key={o.id}
              role="option"
              aria-selected={o.id === value}
              className={`${i === active ? 'active' : ''} ${o.id === value ? 'current' : ''}`}
              // 입력 포커스가 빠지기 전에 선택되도록 mousedown 기본 동작을 막습니다.
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(o)}
            >
              <span>{o.name}</span>
              <small>{KIND_LABEL[o.kind]}</small>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
