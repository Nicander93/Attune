/** User-facing copy for the import main path. Keep jargon out of these strings. */

export const MAIN_PATH_JARGON =
  /ffmpeg|ffprobe|\bASR\b|\bOCR\b|LGPL|BtbN|抽轨|PGS|ATTUNE_FFMPEG_DIR/i;

export function containsMainPathJargon(text: string): boolean {
  return MAIN_PATH_JARGON.test(text);
}

export function megabytesLabel(bytes: number): string {
  return String(Math.max(1, Math.round(bytes / 1_048_576)));
}

export const COPY = {
  dropTitle: '选择或拖入文件',
  dropHint: '音频或视频都可以',
  chooseFile: '选择文件',
  readingFile: '正在读取…',
  preparingSubtitles: '正在准备字幕…',
  preparingMedia: '正在准备素材…',
  readingSubtitles: '正在读取字幕…',
  noSubtitlesYet: '还没有字幕',
  startDictationNeedsText: '需要先有参考原文才能开始听写',
  videoNeedsDesktop: '视频导入需要桌面版，请改用音频文件，或在桌面应用中打开。',
  noAudioTrack: '这段视频没有可用的声音，无法用于听写。',
  multipleAudioTracks: '这段视频有多条音轨，请选择要用于听写的一条。',
  continueWithTrack: '继续',
  subtitlePickAfterFailure:
    '没能从自动选择的字幕里得到可用的句子。请另选一条，或改为自动识别语音。',
  recognizeInstead: '改为自动识别',
  tryPictureText: '尝试从画面中识别字幕',
  toolsCancelled: '已取消安装本地工具。',
  toolsInstallFailed: '本地工具安装失败，暂时无法处理这段视频。',
  toolsStillMissing: '本地工具安装完成，但仍无法处理视频。',
  videoProcessFailed: '这段视频没能处理完成。',
  videoPathMissing: '无法确定这个视频文件的位置，请使用「选择文件」。',
  recognitionFailed: '没能自动准备好字幕。',
  recognitionNoModel: '还不能准备字幕，请在识别设置里选择一种识别方式。',
  recognitionNoSpeech: '没有识别出可用的英文句子。',
  recognitionCancelled: '已取消，字幕没有改动。',
  downloadingModel: '正在下载识别数据…',
  importingModel: '正在导入识别数据…',
  pictureTextFailed: '没能从画面中识别出可用的字幕。',
  pictureTextUnavailable: '这台电脑暂时无法从画面中识别字幕。',
};

export function readyToDictate(count: number): string {
  return `已准备好 ${count} 句，可以开始听写`;
}

export function preparingSubtitlesWithPercent(percent: number): string {
  return `正在准备字幕… ${Math.round(percent)}%`;
}

export function toolsConsentMessage(sizeMb: number): string {
  return `要处理这段视频，需要在这台电脑上安装一套本地工具（约 ${sizeMb} MB），只用于本机。是否同意安装？`;
}

export function toolsProgressLabel(percent?: number): string {
  return percent === undefined ? '正在安装本地工具…' : `正在安装本地工具… ${percent}%`;
}

export function modelConsentMessage(sizeMb: number): string {
  return `要准备字幕，需要先在本机下载一套识别数据（约 ${sizeMb} MB），只用于这台电脑。是否同意？`;
}

export function downloadingModelProgress(downloadedMb: string, totalMb: string): string {
  return `正在下载识别数据：${downloadedMb} / ${totalMb} MB`;
}

export function audioTrackLabel(language: string | undefined, indexAmongAudio: number): string {
  const n = indexAmongAudio + 1;
  const label = languageName(language);
  return label ? `第 ${n} 条（${label}）` : `第 ${n} 条`;
}

export function subtitleTrackLabel(language: string | undefined, indexAmongText: number): string {
  const n = indexAmongText + 1;
  const label = languageName(language);
  return label ? `字幕 ${n}（${label}）` : `字幕 ${n}`;
}

export function languageName(code?: string): string | undefined {
  if (!code) return undefined;
  const lower = code.toLowerCase();
  if (lower.startsWith('en') || lower === 'eng') return '英语';
  if (lower.startsWith('zh') || lower === 'chi' || lower === 'cmn') return '中文';
  if (lower.startsWith('ja') || lower === 'jpn') return '日语';
  if (lower.startsWith('ko') || lower === 'kor') return '韩语';
  if (lower.startsWith('fr') || lower === 'fre' || lower === 'fra') return '法语';
  if (lower.startsWith('de') || lower === 'ger' || lower === 'deu') return '德语';
  if (lower.startsWith('es') || lower === 'spa') return '西班牙语';
  return code;
}

export interface UserFacingError {
  message: string;
  detail?: string;
}

export function normalizeErrorText(err: unknown): string {
  return String(err ?? '')
    .replace(/^Error:\s*/, '')
    .trim();
}

/** First sentence stays plain; jargon or backend text goes under 详情. */
export function toUserFacingError(err: unknown, fallback: string): UserFacingError {
  const raw = normalizeErrorText(err);
  if (!raw) return { message: fallback };
  if (!containsMainPathJargon(raw)) return { message: raw };
  return { message: fallback, detail: raw };
}
