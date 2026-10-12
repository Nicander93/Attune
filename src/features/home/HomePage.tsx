import type { Material } from '../../domain/types';
import { formatTime } from '../../domain/types';
import { recentStudy } from '../../domain/progress';

const viewLabel = (material: Material) => (material.lastView === 'reading' ? '听读' : '听写');

/** Only shows a time we actually have; legacy records show nothing rather than a guess. */
const studiedLabel = (iso: string | undefined) => {
  if (!iso) return '';
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? '' : ` · ${at.toLocaleDateString()}`;
};

/**
 * 首页 is about resuming, not reporting. The only thing it offers is the material the
 * user was last actually studying, and a short recent list. Nothing here is derived
 * from import order - a material that was imported and never opened does not appear.
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

  return (
    <section className="home">
      <div className="page-heading">
        <div>
          <p className="eyebrow">首页</p>
          <h1>继续学习</h1>
        </div>
        <button className="primary" onClick={props.onNewMaterial} disabled={!ready}>
          ＋ 新建素材
        </button>
      </div>

      {!ready ? (
        <p className="muted">正在打开本地数据…</p>
      ) : resume ? (
        <>
          <article className="resume">
            <button className="resume__main" onClick={() => props.onContinue(resume.material.id)}>
              <span className="resume__title">{resume.material.displayName}</span>
              <span className="muted">
                {viewLabel(resume.material)} · 已听写 {resume.progress.completed} /{' '}
                {resume.progress.total} 句
              </span>
            </button>
            <button className="primary" onClick={() => props.onContinue(resume.material.id)}>
              继续听写 →
            </button>
          </article>

          <div className="section-heading">
            <h2>最近学习</h2>
            <button className="quiet" onClick={props.onOpenLibrary}>
              查看素材库 →
            </button>
          </div>
          <ul className="recent">
            {recent.map(({ material, progress, studiedAt }) => (
              <li key={material.id}>
                <button className="recent__row" onClick={() => props.onContinue(material.id)}>
                  <span>
                    <strong>{material.displayName}</strong>
                    <span className="muted">
                      已听写 {progress.completed} / {progress.total} 句 ·{' '}
                      {formatTime(material.duration)}
                      {studiedLabel(studiedAt)}
                    </span>
                  </span>
                  <span className="muted" aria-hidden="true">
                    ›
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div className="empty">
          <h2>还没有开始听写</h2>
          <p className="muted">
            导入一段音频和字幕，就可以开始第一篇听写。所有数据只保存在这台机器上。
          </p>
          <button className="primary" onClick={props.onNewMaterial} disabled={!ready}>
            打开素材库
          </button>
        </div>
      )}
    </section>
  );
}
