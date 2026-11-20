// 카드 할인 규칙은 결제수단(payment) 기록에 들어 있고, 관리 > 결제수단에서 직접 입력합니다.
// payment.benefits         : [{ key, label, unit('percent'|'won'), rate(% 또는 원), examples, limitOptions: [원] }]  거래마다 고르는 혜택 구분과 참고용 분야 한도 옵션
// payment.totalLimitOptions: [원]  참고용 통합 월 한도 옵션
// 달마다 실제 한도(통합 limit, 혜택별 caps)는 discountLimits 컬렉션에 저장합니다. 관리 > 할인 한도에서 입력합니다.

import { formatWon } from '../utils/format';

export const benefitsOf = (payment) => payment?.benefits ?? [];

// 혜택 할인 방식: 'percent'(승인 금액의 %) 또는 'won'(거래마다 정해진 원). 없으면 %.
export const isWonBenefit = (b) => b?.unit === 'won';

// 화면에 보여 줄 할인 값: "7%" 또는 "1,000원"
export const rateText = (b) => (isWonBenefit(b) ? formatWon(b.rate) : `${b.rate}%`);

export const limitsOf = (payment) => payment?.totalLimitOptions ?? [];
