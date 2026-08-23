// 礼花特效与音量偏好（localStorage 持久化）
// 与 play-preferences 独立，避免污染既有 store 结构

const CONFETTI_ENABLED_KEY = 'mini-theater.confetti-enabled';
const CONFETTI_SOUND_KEY = 'mini-theater.confetti-sound';

export type ConfettiPrefs = {
  enabled: boolean;
  sound: boolean;
};

const readBool = (key: string, fallback: boolean): boolean => {
  if (typeof window === 'undefined') return fallback;
  const raw = window.localStorage.getItem(key);
  if (raw === null) return fallback;
  return raw === 'true';
};

export const getConfettiPrefs = (): ConfettiPrefs => ({
  enabled: readBool(CONFETTI_ENABLED_KEY, true),
  sound: readBool(CONFETTI_SOUND_KEY, true),
});

export const setConfettiEnabled = (enabled: boolean): ConfettiPrefs => {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(CONFETTI_ENABLED_KEY, String(enabled));
  }
  return { enabled, sound: readBool(CONFETTI_SOUND_KEY, true) };
};

export const setConfettiSound = (sound: boolean): ConfettiPrefs => {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(CONFETTI_SOUND_KEY, String(sound));
  }
  return { enabled: readBool(CONFETTI_ENABLED_KEY, true), sound };
};