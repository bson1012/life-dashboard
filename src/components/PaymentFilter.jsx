import { useEffect, useRef, useState } from 'react';

// 결제수단 필터: 옆의 전체·수입·지출 칩과 같은 모양의 버튼을 누르면 목록이 펼쳐집니다.
// options: [{ id, name }], value: 고른 결제수단 id 또는 'all'
export default function PaymentFilter({ value, options, onChange }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const current = options.find((o) => o.id === value);

  // 목록 바깥을 누르면 닫습니다.
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className="pay-filter" ref={wrapRef}>
      <button
        type="button"
        className={`chip ${value !== 'all' ? 'active' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {current ? current.name : '결제수단'} ▾
      </button>
      {open && (
        <ul className="pay-filter-menu" role="listbox" aria-label="결제수단 필터">
          {[{ id: 'all', name: '전체 결제수단' }, ...options].map((o) => (
            <li key={o.id}>
              <button
                type="button"
                role="option"
                aria-selected={value === o.id}
                className={value === o.id ? 'on' : ''}
                onClick={() => {
                  onChange(o.id);
                  setOpen(false);
                }}
              >
                {o.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
