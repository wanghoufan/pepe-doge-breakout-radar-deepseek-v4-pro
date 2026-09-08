/**
 * Alert 声音：10 种可区分声音，Web Audio 自生成优先（无外部音频文件/网络）。
 *
 * - 每种声音 = 一组振荡器事件（freq/dur/type/delay），由 playAlertSound 按 volume 播放。
 * - 启用声音必须用户点击初始化 AudioContext + 测试音（见 ensureAudioUnlocked），禁静默失败：
 *   未解锁时 playAlertSound 返回 { played:false, reason:'locked' }，UI 必须显示"点击恢复"。
 * - 音量 0-100 + Mute + 默认不大（DEFAULT 40）。
 * - 本模块不触碰任何量化/策略/阈值。
 */

export interface ToneStep {
  freq: number;
  durMs: number;
  delayMs: number;
  type: OscillatorType;
}

export interface SoundDef {
  id: string;
  label: string;
  steps: ToneStep[];
  /** 单次总时长（秒，用于 AUTO 下循环不超关闭时间）。 */
  loopSecs: number;
}

export const ALERT_SOUNDS: SoundDef[] = [
  { id: 'chime-soft', label: '柔和上行', steps: [{ freq: 660, durMs: 220, delayMs: 0, type: 'sine' }, { freq: 880, durMs: 260, delayMs: 240, type: 'sine' }], loopSecs: 0.6 },
  { id: 'chime-double', label: '双音确认', steps: [{ freq: 523, durMs: 180, delayMs: 0, type: 'sine' }, { freq: 523, durMs: 180, delayMs: 260, type: 'sine' }], loopSecs: 0.5 },
  { id: 'pulse-low', label: '低频脉冲', steps: [{ freq: 220, durMs: 300, delayMs: 0, type: 'triangle' }], loopSecs: 0.4 },
  { id: 'pulse-high', label: '高频脉冲', steps: [{ freq: 1175, durMs: 160, delayMs: 0, type: 'triangle' }], loopSecs: 0.3 },
  { id: 'sweep-up', label: '上扫', steps: [{ freq: 440, durMs: 140, delayMs: 0, type: 'sawtooth' }, { freq: 660, durMs: 140, delayMs: 150, type: 'sawtooth' }, { freq: 880, durMs: 200, delayMs: 300, type: 'sawtooth' }], loopSecs: 0.6 },
  { id: 'sweep-down', label: '下扫', steps: [{ freq: 880, durMs: 140, delayMs: 0, type: 'sawtooth' }, { freq: 660, durMs: 140, delayMs: 150, type: 'sawtooth' }, { freq: 440, durMs: 200, delayMs: 300, type: 'sawtooth' }], loopSecs: 0.6 },
  { id: 'triple-beep', label: '三连音', steps: [{ freq: 740, durMs: 120, delayMs: 0, type: 'square' }, { freq: 740, durMs: 120, delayMs: 180, type: 'square' }, { freq: 740, durMs: 120, delayMs: 360, type: 'square' }], loopSecs: 0.5 },
  { id: 'soft-block', label: '闷音块', steps: [{ freq: 330, durMs: 400, delayMs: 0, type: 'sine' }], loopSecs: 0.5 },
  { id: 'alert-stair', label: '阶梯三级', steps: [{ freq: 392, durMs: 150, delayMs: 0, type: 'triangle' }, { freq: 523, durMs: 150, delayMs: 170, type: 'triangle' }, { freq: 659, durMs: 220, delayMs: 340, type: 'triangle' }], loopSecs: 0.6 },
  { id: 'alert-long', label: '长鸣提醒', steps: [{ freq: 988, durMs: 500, delayMs: 0, type: 'sine' }], loopSecs: 0.6 },
];

export function getSoundDef(id: string): SoundDef {
  return ALERT_SOUNDS.find((s) => s.id === id) ?? ALERT_SOUNDS[0];
}

let unlocked = false;
let ctx: AudioContext | null = null;

/** 正在发声的节点（试听/报警可被随时停止，见 stopAlertSound）。 */
let liveNodes: { osc: OscillatorNode; gain: GainNode }[] = [];

export function isAudioUnlocked(): boolean {
  return unlocked;
}

/** 必须在用户点击手势中调用：创建/恢复 AudioContext + 播放测试音。 */
export async function ensureAudioUnlocked(testSoundId?: string): Promise<{ ok: boolean; reason: string | null }> {
  try {
    if (typeof window === 'undefined') return { ok: false, reason: 'no-window' };
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return { ok: false, reason: 'unsupported' };
    if (!ctx) ctx = new AC();
    if (ctx.state === 'suspended') await ctx.resume();
    unlocked = ctx.state === 'running';
    if (unlocked) {
      // 测试音：短促单音，音量固定小，证明链路可用。
      playSteps(getSoundDef(testSoundId ?? 'chime-soft').steps.slice(0, 1), 20, ctx);
    }
    return { ok: unlocked, reason: unlocked ? null : 'suspended' };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

function playSteps(soundSteps: ToneStep[], volume: number, ac: AudioContext): void {
  const gain = ac.createGain();
  gain.gain.value = Math.min(1, Math.max(0, volume / 100)) * 0.5; // 上限钳制，默认不大
  gain.connect(ac.destination);
  const now = ac.currentTime;
  for (const s of soundSteps) {
    const osc = ac.createOscillator();
    osc.type = s.type;
    osc.frequency.value = s.freq;
    osc.connect(gain);
    osc.start(now + s.delayMs / 1000);
    osc.stop(now + (s.delayMs + s.durMs) / 1000);
    const entry = { osc, gain };
    liveNodes.push(entry);
    osc.onended = () => {
      const i = liveNodes.indexOf(entry);
      if (i >= 0) liveNodes.splice(i, 1);
    };
  }
}

/**
 * 停止当前所有声音（试听切换/停止试听/停止当前声音共用）。
 * - 直接停掉正在发声的振荡器并断开增益；调用后无残留鸣响。
 * - 切换声音前调用可保证"先停旧声再播新声"。
 */
export function stopAlertSound(): void {
  const nodes = liveNodes;
  liveNodes = [];
  for (const { osc } of nodes) {
    try {
      osc.onended = null;
      osc.stop();
    } catch { /* 已结束则忽略 */ }
    try {
      osc.disconnect();
    } catch { /* 忽略 */ }
  }
}

export function playAlertSound(
  soundId: string,
  volume: number,
  muted: boolean,
): { played: boolean; reason: string | null } {
  if (muted || volume <= 0) return { played: false, reason: 'muted' };
  if (!unlocked || !ctx || ctx.state !== 'running') return { played: false, reason: 'locked' };
  try {
    playSteps(getSoundDef(soundId).steps, volume, ctx);
    return { played: true, reason: null };
  } catch {
    return { played: false, reason: 'error' };
  }
}

/** 测试工具：重置解锁态（单测/故事书用）。 */
export function __resetAudioForTest(): void {
  unlocked = false;
  ctx = null;
  liveNodes = [];
}
