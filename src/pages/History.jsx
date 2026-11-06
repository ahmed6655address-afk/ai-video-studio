import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon.jsx';
import {
  EmptyState,
  Modal,
  Spinner,
  accentOf,
  formatDateTime,
  statusMeta,
  timeAgo,
  useToast,
} from '../components/ui.jsx';
import { studio } from '../api.js';
import { useSession } from '../session.jsx';

const PAGE = 12;

const STATUS_FILTERS = [
  { value: '', label: 'كل الحالات' },
  { value: 'pending_provider', label: 'بانتظار المزوّد' },
  { value: 'queued', label: 'في الانتظار' },
  { value: 'completed', label: 'مكتمل' },
  { value: 'failed', label: 'فشل' },
];

export default function History() {
  const { tools } = useSession();
  const toast = useToast();
  const [params, setParams] = useSearchParams();

  const [toolFilter, setToolFilter] = useState(params.get('tool') || '');
  const [statusFilter, setStatusFilter] = useState(params.get('status') || '');
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const query = useMemo(() => {
    const search = new URLSearchParams();
    if (toolFilter) search.set('tool', toolFilter);
    if (statusFilter) search.set('status', statusFilter);
    search.set('limit', String(PAGE));
    return search.toString();
  }, [toolFilter, statusFilter]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await studio.projects(`?${query}`);
      setRows(data.projects || []);
      setTotal(data.total || 0);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const projectId = Number(params.get('project'));
    if (!projectId) {
      setSelected(null);
      return;
    }
    const existing = rows.find((row) => row.id === projectId);
    if (existing) {
      setSelected(existing);
      return;
    }
    studio
      .project(projectId)
      .then((data) => setSelected(data.project))
      .catch(() => {});
  }, [params, rows]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const search = new URLSearchParams(query);
      search.set('offset', String(rows.length));
      const data = await studio.projects(`?${search.toString()}`);
      setRows((prev) => [...prev, ...(data.projects || [])]);
      setTotal(data.total || 0);
    } catch (err) {
      toast.push(err.message, 'error');
    } finally {
      setLoadingMore(false);
    }
  }

  async function handleDelete(project) {
    setDeleting(project.id);
    try {
      await studio.deleteProject(project.id);
      setRows((prev) => prev.filter((row) => row.id !== project.id));
      setTotal((prev) => Math.max(prev - 1, 0));
      if (selected?.id === project.id) closeDetail();
      toast.push('تم حذف المشروع.', 'success');
    } catch (err) {
      toast.push(err.message, 'error');
    } finally {
      setDeleting(null);
    }
  }

  function closeDetail() {
    setSelected(null);
    const next = new URLSearchParams(params);
    next.delete('project');
    setParams(next, { replace: true });
  }

  function openDetail(project) {
    setSelected(project);
    const next = new URLSearchParams(params);
    next.set('project', String(project.id));
    setParams(next, { replace: true });
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">السجل</p>
          <h1 className="page-title">مشاريعي</h1>
          <p className="muted small">كل الطلبات المحفوظة، مع حالتها ووصفها وخياراتها.</p>
        </div>
        <Link to="/app/tools/text_video" className="btn btn-primary btn-sm">
          <Icon name="wand" size={16} /> مشروع جديد
        </Link>
      </header>

      <div className="card card-pad filters">
        <label className="filter">
          <span className="small muted">الأداة</span>
          <select className="input select" value={toolFilter} onChange={(event) => setToolFilter(event.target.value)}>
            <option value="">كل الأدوات</option>
            {tools.map((tool) => (
              <option key={tool.id} value={tool.id}>{tool.nameAr}</option>
            ))}
          </select>
        </label>
        <label className="filter">
          <span className="small muted">الحالة</span>
          <select className="input select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            {STATUS_FILTERS.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
        </label>
        <div className="filter grow" style={{ justifyContent: 'flex-end' }}>
          <span className="small faint">{total} مشروع</span>
        </div>
      </div>

      {error && (
        <div className="alert alert-danger">
          <Icon name="alert" size={16} /> {error}
        </div>
      )}

      {loading ? (
        <div className="card card-pad center" style={{ marginTop: 14 }}>
          <Spinner /> <span className="muted small">جارٍ تحميل السجل…</span>
        </div>
      ) : rows.length ? (
        <>
          <div className="list" style={{ marginTop: 14 }}>
            {rows.map((project) => {
              const meta = statusMeta(project.status);
              const tool = tools.find((t) => t.id === project.tool);
              const accent = accentOf(tool?.accent);
              return (
                <article key={project.id} className="list-row card card-hover">
                  <button type="button" className="list-main" onClick={() => openDetail(project)}>
                    <span className="tool-icon sm" style={{ background: accent.soft, color: accent.color }}>
                      <Icon name={tool?.icon || 'film'} size={16} />
                    </span>
                    <span className="grow" style={{ textAlign: 'start' }}>
                      <span className="list-title">{project.prompt}</span>
                      <span className="muted small" style={{ display: 'block', marginTop: 2 }}>
                        {project.toolNameAr} · {timeAgo(project.createdAt)}
                      </span>
                    </span>
                  </button>
                  <span className={`badge badge-${meta.tone}`}>
                    <span className="dot" /> {meta.label}
                  </span>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => handleDelete(project)}
                    disabled={deleting === project.id}
                    aria-label="حذف"
                    title="حذف المشروع"
                  >
                    {deleting === project.id ? <Spinner size={14} /> : <Icon name="trash" size={16} />}
                  </button>
                </article>
              );
            })}
          </div>

          {rows.length < total && (
            <div className="center" style={{ marginTop: 16 }}>
              <button type="button" className="btn btn-outline btn-sm" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? <Spinner size={15} /> : <Icon name="arrow" size={15} />} تحميل المزيد
              </button>
            </div>
          )}
        </>
      ) : (
        <div style={{ marginTop: 14 }}>
          <EmptyState
            icon="film"
            title="لا توجد مشاريع مطابقة"
            action={
              <Link to="/app/tools/text_video" className="btn btn-primary btn-sm">
                <Icon name="wand" size={16} /> ابدأ مشروعًا
              </Link>
            }
          >
            جرّب تغيير عوامل التصفية أو أنشئ مشروعًا جديدًا.
          </EmptyState>
        </div>
      )}

      <Modal
        open={Boolean(selected)}
        title={selected ? `مشروع #${selected.id}` : ''}
        onClose={closeDetail}
        width={620}
        footer={
          selected && (
            <>
              <button type="button" className="btn btn-ghost btn-sm" onClick={closeDetail}>إغلاق</button>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={() => handleDelete(selected)}
                disabled={deleting === selected.id}
              >
                <Icon name="trash" size={15} /> حذف المشروع
              </button>
            </>
          )
        }
      >
        {selected && (
          <div>
            <div className="row-between" style={{ marginBottom: 10 }}>
              <span className={`badge badge-${statusMeta(selected.status).tone}`}>
                <span className="dot" /> {statusMeta(selected.status).label}
              </span>
              <span className="small faint">{formatDateTime(selected.createdAt)}</span>
            </div>

            <p className="detail-prompt">{selected.prompt}</p>

            {selected.negativePrompt && (
              <p className="small muted">وصف سلبي: {selected.negativePrompt}</p>
            )}

            <div className="placeholder-media" style={{ marginTop: 12 }}>
              <Icon name={selected.outputUrl ? 'film' : 'alert'} size={26} />
              <span className="small faint">
                {selected.outputUrl
                  ? 'الملف الناتج متاح'
                  : 'لا يوجد ملف ناتج — المزوّد غير متصل بهذه الأداة بعد'}
              </span>
            </div>

            <dl className="meta-list" style={{ marginTop: 14 }}>
              <div><dt>الأداة</dt><dd>{selected.toolNameAr}</dd></div>
              <div><dt>المزوّد</dt><dd>{selected.provider || 'غير متصل'}</dd></div>
              {selected.providerJobId && <div><dt>معرّف المزوّد</dt><dd dir="ltr">{selected.providerJobId}</dd></div>}
              <div><dt>آخر تحديث</dt><dd>{timeAgo(selected.updatedAt)}</dd></div>
              {Object.entries(selected.options || {}).map(([key, value]) => (
                <div key={key}><dt>{key}</dt><dd>{String(value)}</dd></div>
              ))}
            </dl>

            {selected.errorMessage && (
              <div className="alert alert-danger" style={{ marginTop: 10 }}>
                <Icon name="alert" size={15} /> {selected.errorMessage}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
