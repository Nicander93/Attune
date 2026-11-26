import { useRef, useState } from 'react';
import type { Material } from '../../domain/types';
import type { MediaProbe, MediaStreamInfo } from '../../media';
import { COPY, toUserFacingError, type UserFacingError } from './import-messages';
import {
  applyOcrSubtitles,
  applyVideoImport,
  ensureLocalMediaTools,
  probeAndPlanVideo,
  type VideoPreparePlan,
} from './prepare-video';

type Callbacks = {
  material: Material;
  update: (transform: (material: Material) => Material) => void;
  onNeedRecognition: () => void;
  onNotice: (message: string) => void;
};

export type VideoChoice =
  | { kind: 'audio'; probe: MediaProbe; plan: VideoPreparePlan }
  | {
      kind: 'subtitle';
      probe: MediaProbe;
      plan: VideoPreparePlan;
      remaining: MediaStreamInfo[];
      detail: string;
    };

export function useAutoVideoImport({ material, update, onNeedRecognition, onNotice }: Callbacks) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<UserFacingError | null>(null);
  const [choice, setChoice] = useState<VideoChoice | null>(null);
  const materialRef = useRef(material);
  const updateRef = useRef(update);
  const needRecognitionRef = useRef(onNeedRecognition);
  const noticeRef = useRef(onNotice);
  materialRef.current = material;
  updateRef.current = update;
  needRecognitionRef.current = onNeedRecognition;
  noticeRef.current = onNotice;

  function begin() {
    setError(null);
    setChoice(null);
    setBusy(true);
    setProgress(COPY.preparingMedia);
  }

  function end() {
    setBusy(false);
    setProgress('');
  }

  async function finish(probe: MediaProbe, plan: VideoPreparePlan, audioStream: number) {
    if (audioStream === undefined || Number.isNaN(audioStream)) {
      setError({ message: COPY.noAudioTrack });
      end();
      return;
    }
    setBusy(true);
    setChoice(null);
    const result = await applyVideoImport({
      probe,
      material: materialRef.current,
      update: updateRef.current,
      audioStream,
      subtitleStream: plan.subtitleStream,
      clipStart: plan.clipStart,
      clipEnd: plan.clipEnd,
      onProgress: setProgress,
    });
    if (result.status === 'ready' || result.status === 'protected') {
      end();
      return;
    }
    if (result.status === 'need-recognition') {
      end();
      needRecognitionRef.current();
      return;
    }
    if (result.status === 'subtitle-failed') {
      if (result.remainingSubtitleStreams.length > 0) {
        setChoice({
          kind: 'subtitle',
          probe,
          plan,
          remaining: result.remainingSubtitleStreams,
          detail: result.detail,
        });
        end();
        return;
      }
      end();
      needRecognitionRef.current();
      return;
    }
    setError(result);
    end();
  }

  async function startFromPath(path: string) {
    begin();
    try {
      const tools = await ensureLocalMediaTools({ onProgress: setProgress });
      if (tools.status === 'cancelled') {
        noticeRef.current(COPY.toolsCancelled);
        end();
        return;
      }
      if (tools.status === 'failed') {
        setError(tools);
        end();
        return;
      }
      const { probe, plan } = await probeAndPlanVideo(path);
      if (plan.audioStream === undefined) {
        setError({ message: COPY.noAudioTrack });
        end();
        return;
      }
      if (plan.needsAudioChoice) {
        setChoice({ kind: 'audio', probe, plan });
        end();
        return;
      }
      await finish(probe, plan, plan.audioStream);
    } catch (err) {
      setError(toUserFacingError(err, COPY.videoProcessFailed));
      end();
    }
  }

  async function confirmAudioStream(audioStream: number) {
    if (!choice || choice.kind !== 'audio') return;
    await finish(choice.probe, { ...choice.plan, audioStream }, audioStream);
  }

  async function confirmSubtitleStream(subtitleStream: number) {
    if (!choice || choice.kind !== 'subtitle') return;
    await finish(choice.probe, { ...choice.plan, subtitleStream }, choice.plan.audioStream ?? 0);
  }

  function recognizeInstead() {
    setChoice(null);
    needRecognitionRef.current();
  }

  async function tryPictureText() {
    const current = materialRef.current;
    const video = current.video;
    if (!video?.sourcePath) {
      setError({ message: COPY.pictureTextUnavailable });
      return;
    }
    begin();
    const result = await applyOcrSubtitles({
      sourcePath: video.sourcePath,
      material: current,
      update: updateRef.current,
      clipStart: video.clipStart,
      clipEnd: video.clipEnd,
    });
    if (result.status === 'failed') setError(result);
    end();
  }

  return {
    busy,
    progress,
    error,
    choice,
    startFromPath,
    confirmAudioStream,
    confirmSubtitleStream,
    recognizeInstead,
    tryPictureText,
    clearError: () => setError(null),
  };
}
