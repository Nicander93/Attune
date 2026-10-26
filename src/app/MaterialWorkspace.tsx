import { useEffect } from 'react';
import type { Material } from '../domain/types';
import type { Route } from './routes';
import { MaterialPrepPage } from '../features/material/MaterialPrepPage';
import { SubtitleProofPage } from '../features/subtitles/SubtitleProofPage';
import { StudyPage } from '../features/study/StudyPage';
import { TranscriptPage } from '../features/reading/TranscriptPage';
import { MediaOutput } from '../features/player/Player';
import { useMediaPlayer } from '../features/player/useMediaPlayer';

interface Props {
  material: Material;
  route: Route;
  update: (transform: (material: Material) => Material) => void;
  go: (route: Route) => void;
  onBack: () => void;
  onNotice: (message: string) => void;
}

export function MaterialWorkspace({ material, route, update, go, onBack, onNotice }: Props) {
  const player = useMediaPlayer(
    material,
    (seconds) => update((m) => ({ ...m, playbackPosition: seconds })),
    (settings) => update((m) => ({ ...m, playbackSettings: settings })),
    () => update((m) => ({ ...m, lastStudiedAt: new Date().toISOString() })),
  );
  useEffect(() => {
    if (route.name !== 'study') player.setVideoSurface('hidden');
  }, [route.name, player.hasVideoSurface]);
  return (
    <>
      <MediaOutput player={player} />
      {route.name === 'study' && (
        <StudyPage
          material={material}
          player={player}
          update={update}
          onBack={onBack}
          onNotice={onNotice}
          onPrepare={() => go({ name: 'material', materialId: material.id, from: 'study' })}
          onSubtitles={() => go({ name: 'subtitles', materialId: material.id })}
          onTranscript={() => go({ name: 'transcript', materialId: material.id })}
        />
      )}
      {route.name === 'material' && (
        <MaterialPrepPage
          material={material}
          update={update}
          onBack={onBack}
          onNotice={onNotice}
          onSubtitles={() => go({ name: 'subtitles', materialId: material.id })}
          onStudy={(view) => {
            update((m) => ({ ...m, lastView: view }));
            if (!material.playbackSettings)
              player.setMode(view === 'reading' ? 'continuous' : 'segment');
            go({ name: 'study', materialId: material.id, from: 'material' });
          }}
        />
      )}
      {route.name === 'subtitles' && (
        <SubtitleProofPage
          material={material}
          player={player}
          update={update}
          onBack={onBack}
          onNotice={onNotice}
        />
      )}
      {route.name === 'transcript' && (
        <TranscriptPage material={material} player={player} onBack={onBack} />
      )}
    </>
  );
}
