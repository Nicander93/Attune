import { useEffect, useMemo, useRef, useState } from 'react';
import type { Material, SubtitleSegment } from '../../domain/types';
import { formatTime } from '../../domain/types';
import { toSrt } from '../../domain/subtitles';
import {
  SubtitleError,
  editSegment,
  mergeWithNext,
  splitSegment,
  validateSpan,
} from '../../domain/subtitle-edits';
import { saveTextFile } from '../../desktop';
import { Player } from '../player/Player';
import { useAudioPlayer } from '../player/useAudioPlayer';

type Props = {
  material: Material;
  update: (transform: (material: Material) => Material) => void;
  onBack: () => void;
  onNotice: (message: string) => void;
};

/** A sentence being edited in place, with its own draft of the fields. */
type Draft = { reference: string; start: string; end: string };

const toDraft = (segment: SubtitleSegment): Draft => ({
  reference: segment.reference,
  start: segment.start.toFixed(2),
  end: segment.end.toFixed(2),
});

export function SubtitleProofPage({ material, update, onBack, onNotice }: Props) {
  const player = useAudioPlayer(material, (seconds) =>
    update((m) => ({ ...m, playbackPosition: seconds })),
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState('');
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  const activeId = player.playbackSegment?.id ?? material.segments[0]?.id;
  const stale = useMemo(
    () => new Set(material.rounds.flatMap((r) => r.staleSegmentIds ?? [])),
    [material.rounds],
  );

  useEffect(() => {
    if (editingId) fieldRef.current?.focus();
  }, [editingId]);

  // Typing must not be dragged away by playback following along.
  useEffect(() => {
    if (editingId) player.pause();
  }, [editingId, player.pause]);

  function beginEdit(segment: SubtitleSegment) {
    setEditingId(segment.id);
    setDraft(toDraft(segment));
    setError('');
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(null);
    setError('');
  }

  function applyEdit(segmentId: string, edit: Parameters<typeof editSegment>[2]) {
    try {
      const { material: next, report } = editSegment(material, segmentId, edit);
      update(() => next);
      cancelEdit();
      reportStale(report.stale);
    } catch (err) {
      setError(err instanceof SubtitleError ? err.message : String(err));
    }
  }

  function reportStale(ids: string[]) {
    if (!ids.length) return;
    onNotice(
      ids.length === 1
        ? '这句的原文改了，已标记为待重新核对。'
        : `${ids.length} 句的原文改了，已标记为待重新核对。`,
    );
  }

  function saveDraft(segmentId: string) {
    if (!draft) return;
    const start = Number(draft.start);
    const end = Number(draft.end);
    const problem = validateSpan(material, segmentId, start, end);
    if (problem) {
      setError(problem);
      return;
    }
    applyEdit(segmentId, { reference: draft.reference.trim(), start, end });
  }

  function handleSplit(segmentId: string) {
    const at = player.position;
    try {
      const { material: next, report } = splitSegment(material, segmentId, at);
      update(() => next);
      const created = next.segments.find((s) => s.start === at);
      if (created) {
        setEditingId(created.id);
        setDraft(toDraft(created));
      }
      reportStale(report.stale);
    } catch (err) {
      setError(String(err));
    }
  }

  function handleMerge(segmentId: string) {
    try {
      const { material: next, report } = mergeWithNext(material, segmentId);
      update(() => next);
      setEditingId(null);
      reportStale(report.stale);
      if (report.lost.length)
        onNotice(`已合并。后一句上的记录无法迁移（${report.lost.length} 处），请重新核对。`);
    } catch (err) {
      setError(String(err));
    }
  }

  async function exportSrt() {
    const text = toSrt(material.segments);
    if (!text) {
      onNotice('还没有字幕可以导出。');
      return;
    }
    const name = `${material.displayName.replace(/\.[^.]+$/, '')}.srt`;
    if (await saveTextFile(name, text, 'application/x-subrip;charset=utf-8'))
      onNotice('SRT 已导出。');
  }

  return (
    <section className="proof">
      <header className="prep__head">
        <button className="quiet back" onClick={onBack}>
          ← 返回
        </button>
        <div>
          <p className="eyebrow">字幕校对</p>
          <h1>{material.displayName}</h1>
        </div>
        <button className="quiet" onClick={() => void exportSrt()}>
          导出 SRT
        </button>
      </header>

      <Player material={material} player={player} />

      {error && (
        <p className="banner banner--error" role="alert">
          {error}
          <button className="quiet" onClick={() => setError('')}>
            关闭
          </button>
        </p>
      )}

      <ol className="proof__list">
        {material.segments.map((segment, index) => {
          const isEditing = editingId === segment.id;
          const isCurrent = activeId === segment.id;
          return (
            <li key={segment.id} className={isCurrent ? 'is-current' : ''}>
              <button
                className="proof__jump"
                aria-label={`定位第 ${index + 1} 句`}
                onClick={() => player.goToSegment(segment.id, { play: true })}
              >
                {index + 1}
              </button>
              <span className="proof__time muted">
                {formatTime(segment.start)} — {formatTime(segment.end)}
              </span>
              {stale.has(segment.id) && <span className="proof__stale">待重新核对</span>}

              {isEditing && draft ? (
                <div className="proof__editor">
                  <textarea
                    ref={fieldRef}
                    aria-label={`编辑第 ${index + 1} 句字幕`}
                    value={draft.reference}
                    onChange={(event) => setDraft({ ...draft, reference: event.target.value })}
                    onKeyDown={(event) => {
                      if (event.nativeEvent.isComposing) return;
                      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                        event.preventDefault();
                        saveDraft(segment.id);
                      }
                      if (event.key === 'Escape') {
                        event.preventDefault();
                        cancelEdit();
                      }
                    }}
                  />
                  {segment.translation && <p className="muted">中文：{segment.translation}</p>}
                  <div className="row">
                    <label className="muted">
                      开始
                      <input
                        type="number"
                        step="0.01"
                        min={0}
                        aria-label={`第 ${index + 1} 句开始时间`}
                        value={draft.start}
                        onChange={(event) => setDraft({ ...draft, start: event.target.value })}
                      />
                    </label>
                    <label className="muted">
                      结束
                      <input
                        type="number"
                        step="0.01"
                        min={0}
                        aria-label={`第 ${index + 1} 句结束时间`}
                        value={draft.end}
                        onChange={(event) => setDraft({ ...draft, end: event.target.value })}
                      />
                    </label>
                    <button className="primary" onClick={() => saveDraft(segment.id)}>
                      保存
                    </button>
                    <button className="quiet" onClick={cancelEdit}>
                      取消
                    </button>
                  </div>
                  <p className="muted">Ctrl+Enter 保存 · Esc 取消</p>
                </div>
              ) : (
                <div className="proof__text">
                  <button className="proof__line" onClick={() => beginEdit(segment)}>
                    {segment.reference || <span className="muted">（空句，点这里填写）</span>}
                  </button>
                  {segment.translation && <p className="muted">{segment.translation}</p>}
                  <div className="row proof__actions">
                    <button className="quiet" onClick={() => beginEdit(segment)}>
                      编辑
                    </button>
                    <button className="quiet" onClick={() => handleSplit(segment.id)}>
                      在播放位置拆分
                    </button>
                    <button
                      className="quiet"
                      disabled={index === material.segments.length - 1}
                      onClick={() => handleMerge(segment.id)}
                    >
                      与下一句合并
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
