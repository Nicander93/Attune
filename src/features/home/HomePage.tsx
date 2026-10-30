import type { Material } from '../../domain/types';
import { formatTime } from '../../domain/types';
import { recentStudy } from '../../domain/progress';
import { homeProgressLabel } from '../library/listing';

const viewLabel = (material: Material) => (material.lastView === 'reading' ? '听读' : '听写');

/** Only shows a time we actually have; legacy records show nothing rather than a guess. */
const studiedLabel = (iso: string | undefined) => {
  if (!iso) return '';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const today = new Date();
  const sameDay =
    at.getFullYear() === today.getFullYear() &&
    at.getMonth() === today.getMonth() &&
    at.getDate() === today.getDate();
  if (sameDay) return '今天';
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const sameYesterday =
    at.getFullYear() === yesterday.getFullYear() &&
    at.getMonth() === yesterday.getMonth() &&
    at.getDate() === yesterday.getDate();
  if (sameYesterday) return '昨天';
  return at.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
};

/**
 * S1 home: resume first, then a short recent list. Title is 「继续学习」; import CTA
 * matches the V2 shell. Materials never studied stay off this page.
 */
export function HomePage(props: {
  materials: Material[];
  ready: boolean;
  onContinue: (id: string) => void;
  onOpenLibrary: () => void;
  onNewMaterial: () => void;
}) {
  const { materials, ready } = props;
  const recent = recentStudy(materials, 5);
  const resume = recent[0];
  const others = recent.slice(1, 4);
  const resumePercent =
    resume && resume.progress.total > 0
      ? Math.min(100, Math.round((resume.progress.completed / resume.progress.total) * 100))
      : 0;

  return (
    <section className="home">
      <div className="page-heading">
        <div>
          <h1>继续学习</h1>
        </div>
        <button className="primary" onClick={props.onNewMaterial} disabled={!ready}>
          ＋ 导入素材
        </button>
      </div>

      {!ready ? (
        <p className="muted home__loading">正在打开本地数据…</p>
      ) : resume ? (
        <>
          <div className="home__current resume">
            <div className="minilabel">上次学习</div>
            <div className="home__row">
              <div>
                <div className="home__title">{resume.material.displayName}</div>
                <div className="home__subtitle">
                  {homeProgressLabel(
                    viewLabel(resume.material),
                    resume.progress.completed,
                    resume.progress.total,
                  )}
                </div>
              </div>
              <button
                className="primary home__go"
                onClick={() => props.onContinue(resume.material.id)}
              >
                继续 <span aria-hidden="true">→</span>
              </button>
            </div>
            <div className="progress-track" aria-hidden="true">
              <span style={{ width: `${resumePercent}%` }} />
            </div>
          </div>

          <div className="home-recent">
            <div className="section-heading">
              <h2>最近学习</h2>
              <button className="quiet textbtn" onClick={props.onOpenLibrary}>
                全部素材 →
              </button>
            </div>
            {others.length > 0 ? (
              <ul className="recent">
                {others.map(({ material, progress, studiedAt }) => {
                  const when = studiedLabel(studiedAt);
                  return (
                    <li key={material.id}>
                      <button className="recent__row" onClick={() => props.onContinue(material.id)}>
                        <span className="recent__main">
                          <strong className="row-title">{material.displayName}</strong>
                          <span className="muted row-sub">
                            {formatTime(material.duration)}
                            {when ? ` · ${when}` : ''}
                          </span>
                        </span>
                        <span className="row-data muted">
                          {progress.completed} / {progress.total}
                        </span>
                        <span className="row-chevron muted" aria-hidden="true">
                          ›
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="muted empty-row">暂无更多最近学习</p>
            )}
          </div>
        </>
      ) : (
        <div className="empty">
          <h2>还没有开始听写</h2>
          <p className="muted">
            导入一段音频或视频，就可以开始第一篇听写。所有数据只保存在这台机器上。
          </p>
          <button className="primary" onClick={props.onNewMaterial} disabled={!ready}>
            ＋ 导入素材
          </button>
        </div>
      )}
    </section>
  );
}
