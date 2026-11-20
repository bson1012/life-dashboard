export const MOODS = [
  { value: 'great', emoji: '😄', label: '최고' },
  { value: 'good', emoji: '🙂', label: '좋음' },
  { value: 'ok', emoji: '😐', label: '보통' },
  { value: 'bad', emoji: '😞', label: '별로' },
  { value: 'awful', emoji: '😢', label: '힘듦' },
];

export const moodEmoji = (value) => MOODS.find((m) => m.value === value)?.emoji ?? '';
