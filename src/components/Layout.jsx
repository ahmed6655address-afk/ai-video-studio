import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Icon } from './Icon.jsx';
import { accentOf, initials } from './ui.jsx';
import { useSession } from '../session.jsx';

const FALLBACK_TOOLS = [
  { id: 'text_video', shortAr: 'النص إلى فيديو', icon: 'video', accent: 'violet' },
  { id: 'image_video', shortAr: 'الصورة إلى فيديو', icon: 'image', accent: 'cyan' },
  { id: 'voice', shortAr: 'التعليق الصوتي', icon: 'mic', accent: 'amber' },
  { id: 'cartoon', shortAr: 'إنشاء كرتون', icon: 'sparkles', accent: 'rose' },
];

export function Brand({ to = '/', small = false }) {
  return (
    <Link to={to} className="brand" aria-label="AI VIDEO STUDIO — الصفحة الرئيسية">
      <span className="brand-mark" aria-hidden="true">
        <Icon name="film" size={small ? 18 : 21} />
      </span>
      <span className="brand-text">
        <strong>AI VIDEO STUDIO</strong>
        <span>استوديو الفيديو العربي</span>
      </span>
    </Link>
  );
}

export default function Layout({ children }) {
  const { user, entitlements, tools, logout } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [busy, setBusy] = useState(false);
  const list = tools?.length ? tools : FALLBACK_TOOLS;

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  }, [location.pathname]);

  const onLogout = async () => {
    setBusy(true);
    try {
      await logout();
      navigate('/', { replace: true });
    } finally {
      setBusy(false);
    }
  };

  const navItems = [
    { to: '/app', label: 'لوحة التحكم', icon: 'grid', end: true },
    { to: '/app/history', label: 'سجل الفيديوهات', icon: 'history' },
    { to: '/app/profile', label: 'ملفي الشخصي', icon: 'user' },
  ];
  if (entitlements?.isStaff) {
    navItems.push({ to: '/app/admin', label: 'لوحة الإدارة', icon: 'shield' });
  }

  const linkClass = ({ isActive }) => `nav-link${isActive ? ' active' : ''}`;

  return (
    <div className="shell">
      <header className="topbar">
        <Brand to="/app" small />
        <div className="row" style={{ gap: 8 }}>
          {entitlements?.isStaff && (
            <span className="badge badge-violet nowrap" title="حساب إداري — وصول كامل مجاني">
              <Icon name="crown" size={13} /> {user?.role === 'owner' ? 'المالك' : 'إدارة'}
            </span>
          )}
          <Link to="/app/profile" className="avatar" style={{ background: accentOf(user?.avatarColor).grad }} aria-label="ملفي الشخصي">
            {initials(user?.name)}
          </Link>
          <button type="button" className="btn btn-ghost btn-icon" onClick={onLogout} disabled={busy} aria-label="تسجيل الخروج">
            <Icon name="logout" size={18} />
          </button>
        </div>
      </header>

      <div className="shell-body">
        <aside className="sidebar" aria-label="التنقل الرئيسي">
          <p className="eyebrow" style={{ paddingInline: 10 }}>الاستوديو</p>
          {navItems.slice(0, 1).map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={linkClass}>
              <Icon name={item.icon} size={18} />
              <span>{item.label}</span>
            </NavLink>
          ))}

          <p className="eyebrow" style={{ paddingInline: 10, marginTop: 14 }}>الأدوات</p>
          {list.map((tool) => {
            const accent = accentOf(tool.accent);
            return (
              <NavLink key={tool.id} to={`/app/tools/${tool.id}`} className={linkClass}>
                <span className="tool-icon" style={{ width: 28, height: 28, borderRadius: 9, background: accent.soft, color: accent.color }}>
                  <Icon name={tool.icon} size={15} />
                </span>
                <span>{tool.shortAr}</span>
              </NavLink>
            );
          })}

          <p className="eyebrow" style={{ paddingInline: 10, marginTop: 14 }}>الحساب</p>
          {navItems.slice(1).map((item) => (
            <NavLink key={item.to} to={item.to} className={linkClass}>
              <Icon name={item.icon} size={18} />
              <span>{item.label}</span>
            </NavLink>
          ))}

          <div className="grow" />
          <div className="card card-pad" style={{ marginTop: 16 }}>
            <div className="row-between">
              <span className="small muted">الخطة</span>
              <span className="badge badge-info">{entitlements?.unlimited ? 'غير محدودة' : entitlements?.plan?.nameAr || 'بدون اشتراك'}</span>
            </div>
            <p className="faint small" style={{ marginTop: 6 }}>
              {entitlements?.isStaff
                ? 'حساب إداري بوصول كامل ومجاني لكل الأدوات.'
                : entitlements?.hasAccess
                  ? `تنتهي في ${new Date(entitlements.subscription?.expiresAt).toLocaleDateString('ar-EG-u-nu-latn')}`
                  : 'يتطلب التوليد اشتراكًا نشطًا.'}
            </p>
            <Link to="/app/profile" className="btn btn-outline btn-sm btn-block" style={{ marginTop: 10 }}>
              إدارة الاشتراك
            </Link>
          </div>
        </aside>

        <main className="main">{children}</main>
      </div>

      <nav className="bottom-nav" aria-label="التنقل السريع">
        <NavLink to="/app" end className={linkClass}>
          <Icon name="grid" size={20} />
          <span>الرئيسية</span>
        </NavLink>
        <NavLink to={`/app/tools/${list[0]?.id || 'text_video'}`} className={linkClass}>
          <Icon name="wand" size={20} />
          <span>الأدوات</span>
        </NavLink>
        <NavLink to="/app/history" className={linkClass}>
          <Icon name="history" size={20} />
          <span>السجل</span>
        </NavLink>
        <NavLink to="/app/profile" className={linkClass}>
          <Icon name="user" size={20} />
          <span>حسابي</span>
        </NavLink>
        {entitlements?.isStaff && (
          <NavLink to="/app/admin" className={linkClass}>
            <Icon name="shield" size={20} />
            <span>الإدارة</span>
          </NavLink>
        )}
      </nav>
    </div>
  );
}
