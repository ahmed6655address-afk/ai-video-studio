import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon.jsx';
import {
  Field,
  Progress,
  Spinner,
  accentOf,
  formatDate,
  formatNumber,
  initials,
  useToast,
} from '../components/ui.jsx';
import { auth, studio, wallet } from '../api.js';
import { normalizeEntitlements, useSession } from '../session.jsx';

const COLORS = ['violet', 'cyan', 'amber', 'rose', 'emerald', 'gold'];

const ROLE_LABELS = { owner: 'المالك', admin: 'مشرف', user: 'مستخدم' };

export default function Profile() {
  const { user, entitlements, plans, refresh, logout } = useSession();
  const toast = useToast();
  const navigate = useNavigate();

  const [name, setName] = useState(user?.name || '');
  const [avatarColor, setAvatarColor] = useState(user?.avatarColor || 'violet');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileErrors, setProfileErrors] = useState({});

  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [passwordErrors, setPasswordErrors] = useState({});
  const [savingPassword, setSavingPassword] = useState(false);

  const [usage, setUsage] = useState(null);
  const [loadingUsage, setLoadingUsage] = useState(true);
  const [walletData, setWalletData] = useState(null);
  const [loadingWallet, setLoadingWallet] = useState(true);
  const [transferForm, setTransferForm] = useState({ currency: 'LYD', amount: '', paymentReference: '', note: '' });
  const [sendingTransfer, setSendingTransfer] = useState(false);

  useEffect(() => {
    setName(user?.name || '');
    setAvatarColor(user?.avatarColor || 'violet');
  }, [user]);

  useEffect(() => {
    studio
      .dashboard()
      .then((data) => setUsage(data.entitlements))
      .catch(() => {})
      .finally(() => setLoadingUsage(false));
  }, []);

  async function loadWallet() {
    setLoadingWallet(true);
    try {
      const data = await wallet.summary();
      setWalletData(data);
    } catch (err) {
      toast.push(err.message, 'error');
    } finally {
      setLoadingWallet(false);
    }
  }

  useEffect(() => {
    loadWallet();
  }, []);

  const ent = normalizeEntitlements(usage || entitlements, user);
  const accent = accentOf(avatarColor);

  async function saveProfile(event) {
    event.preventDefault();
    setSavingProfile(true);
    setProfileErrors({});
    try {
      await auth.updateProfile({ name: name.trim(), avatarColor });
      await refresh();
      toast.push('تم تحديث الملف الشخصي.', 'success');
    } catch (err) {
      if (err.fields) setProfileErrors(err.fields);
      toast.push(err.message, 'error');
    } finally {
      setSavingProfile(false);
    }
  }

  async function savePassword(event) {
    event.preventDefault();
    const errors = {};
    if (!passwords.currentPassword) errors.currentPassword = 'أدخل كلمة المرور الحالية.';
    if (passwords.newPassword.length < 8) errors.newPassword = 'كلمة المرور الجديدة ٨ أحرف على الأقل.';
    if (passwords.newPassword !== passwords.confirm) errors.confirm = 'كلمتا المرور غير متطابقتين.';
    setPasswordErrors(errors);
    if (Object.keys(errors).length) return;

    setSavingPassword(true);
    try {
      await auth.changePassword({
        currentPassword: passwords.currentPassword,
        newPassword: passwords.newPassword,
      });
      setPasswords({ currentPassword: '', newPassword: '', confirm: '' });
      toast.push('تم تحديث كلمة المرور، وتم إنهاء الجلسات الأخرى.', 'success');
    } catch (err) {
      if (err.fields) setPasswordErrors(err.fields);
      toast.push(err.message, 'error');
    } finally {
      setSavingPassword(false);
    }
  }

  async function submitTransfer(event) {
    event.preventDefault();
    setSendingTransfer(true);
    try {
      await wallet.requestTransfer({
        currency: transferForm.currency,
        amount: transferForm.amount,
        paymentReference: transferForm.paymentReference.trim(),
        note: transferForm.note.trim(),
      });
      setTransferForm((prev) => ({ ...prev, amount: '', paymentReference: '', note: '' }));
      toast.push('تم تسجيل طلب التحويل. سيبقى الرصيد دون تغيير حتى تراجعه الإدارة.', 'success');
      await loadWallet();
    } catch (err) {
      toast.push(err.message, 'error');
    } finally {
      setSendingTransfer(false);
    }
  }

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  if (!user) return null;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">الحساب</p>
          <h1 className="page-title">ملفي الشخصي</h1>
          <p className="muted small">بياناتك، اشتراكك، وحدود الاستخدام الشهرية.</p>
        </div>
        <button type="button" className="btn btn-outline btn-sm" onClick={handleLogout}>
          <Icon name="logout" size={16} /> تسجيل الخروج
        </button>
      </header>

      <div className="profile-grid">
        <section className="card card-pad">
          <div className="row" style={{ gap: 14, marginBottom: 18 }}>
            <span className="avatar lg" style={{ background: accent.grad }}>{initials(user.name)}</span>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.1rem' }}>{user.name}</h2>
              <p className="muted small" style={{ margin: '2px 0 0' }} dir="ltr">{user.email}</p>
              <span className={`badge ${user.role === 'owner' ? 'badge-violet' : user.role === 'admin' ? 'badge-info' : 'badge-default'}`} style={{ marginTop: 6 }}>
                {user.role === 'owner' && <Icon name="crown" size={13} />}
                {ROLE_LABELS[user.role] || user.role}
              </span>
            </div>
          </div>

          <form onSubmit={saveProfile}>
            <Field label="الاسم الكامل" htmlFor="name" error={profileErrors.name} required>
              <input
                id="name"
                className="input"
                value={name}
                maxLength={60}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>

            <Field label="لون الصورة الرمزية">
              <div className="color-row">
                {COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={`color-dot${avatarColor === color ? ' active' : ''}`}
                    style={{ background: accentOf(color).grad }}
                    onClick={() => setAvatarColor(color)}
                    aria-label={color}
                  />
                ))}
              </div>
            </Field>

            <div className="row-between" style={{ marginTop: 8, gap: 10, flexWrap: 'wrap' }}>
              <span className="small faint">تاريخ الانضمام: {formatDate(user.createdAt)}</span>
              <button type="submit" className="btn btn-primary btn-sm" disabled={savingProfile}>
                {savingProfile ? <Spinner size={15} /> : <Icon name="check" size={15} />} حفظ التغييرات
              </button>
            </div>
          </form>
        </section>

        <section className="card card-pad">
          <div className="row-between" style={{ marginBottom: 12 }}>
            <h2 className="section-title" style={{ margin: 0, fontSize: '1.05rem' }}>
              <Icon name="credit" size={17} /> الاشتراك
            </h2>
            {loadingUsage && <Spinner size={14} />}
          </div>

          <div className={`access-pill ${ent?.canGenerate ? 'on' : 'off'}`}>
            <Icon name={ent?.isOwner ? 'crown' : ent?.isStaff ? 'shield' : ent?.hasActiveSubscription ? 'check' : 'lock'} size={16} />
            <span>
              {ent?.isStaff
                ? ent.isOwner ? 'وصول غير محدود (حساب المالك)' : 'وصول غير محدود (حساب إداري)'
                : ent?.hasActiveSubscription
                  ? `خطة ${ent.planNameAr || ent.planCode} نشطة`
                  : 'لا يوجد اشتراك نشط'}
            </span>
          </div>

          <dl className="meta-list" style={{ marginTop: 12 }}>
            <div><dt>الحالة</dt><dd>{ent?.isStaff ? 'غير محدود' : ent?.hasActiveSubscription ? 'نشط' : 'غير نشط'}</dd></div>
            {ent?.subscriptionEndsAt && (
              <div><dt>ينتهي في</dt><dd>{formatDate(ent.subscriptionEndsAt)}</dd></div>
            )}
            <div><dt>الصلاحية</dt><dd>{ROLE_LABELS[user.role] || user.role}</dd></div>
          </dl>

          <h3 style={{ fontSize: '0.95rem', marginTop: 16 }}>الحدود الشهرية</h3>
          <div className="usage-list">
            {(ent?.limits ? Object.keys(ent.limits) : []).map((tool) => {
              const limit = Number(ent.limits[tool]);
              const used = Number(ent.usage?.[tool] ?? 0);
              return (
                <div key={tool} className="usage-row">
                  <div className="row-between small">
                    <span>{ent.toolNames?.[tool] || tool}</span>
                    <span className="muted">
                      {ent.isUnlimited ? `${formatNumber(used)} · غير محدود` : `${formatNumber(used)} / ${formatNumber(limit)}`}
                    </span>
                  </div>
                  <Progress value={used} max={ent.isUnlimited ? Math.max(used, 1) : limit || 1} />
                </div>
              );
            })}
            {!ent?.limits && !loadingUsage && <p className="small faint">لا توجد بيانات استخدام.</p>}
          </div>

          {!ent?.isStaff && (
            <>
              <hr className="divider" />
              <h3 style={{ fontSize: '0.95rem' }}>ترقية الخطة</h3>
              <ul className="plan-mini">
                {plans.filter((plan) => plan.prices?.LYD != null || plan.prices?.USD != null).map((plan) => (
                  <li key={plan.code}>
                    <span>{plan.nameAr}</span>
                    <span className="muted small">
                      {plan.prices?.LYD != null ? `${formatNumber(plan.prices.LYD)} د.ل` : ''}
                      {plan.prices?.LYD != null && plan.prices?.USD != null ? ' · ' : ''}
                      {plan.prices?.USD != null ? `${formatNumber(plan.prices.USD)} USD` : ''}
                      {' · '}{plan.taglineAr}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="alert alert-info" style={{ marginTop: 10 }}>
                <Icon name="alert" size={15} />
                <span>
                  الدفع الإلكتروني غير متصل بعد. لتفعيل اشتراكك تواصل مع إدارة المنصة، وسيتم تفعيل
                  الخطة من لوحة الإدارة.
                </span>
              </div>
              <Link to="/app" className="btn btn-outline btn-sm btn-block" style={{ marginTop: 10 }}>
                <Icon name="grid" size={15} /> استكشف الأدوات
              </Link>
            </>
          )}
        </section>

        <section className="card card-pad">
          <div className="row-between" style={{ marginBottom: 12 }}>
            <h2 className="section-title" style={{ margin: 0, fontSize: '1.05rem' }}>
              <Icon name="wallet" size={17} /> محفظة رصيد الاستخدام
            </h2>
            {loadingWallet && <Spinner size={14} />}
          </div>
          <div className="access-pill on">
            <Icon name="coins" size={16} />
            <span>رصيدك الحالي: {formatNumber(walletData?.wallet?.balance ?? 0)} نقطة استخدام</span>
          </div>
          <p className="small muted" style={{ marginTop: 10 }}>
            هذه نقاط استخدام داخل المنصة وليست أموالاً قابلة للسحب أو التحويل. اختر العملة التي حولت بها فعلياً، ثم أرسل مرجع الحوالة للمراجعة.
          </p>
          <form onSubmit={submitTransfer}>
            <div className="form-grid">
              <Field label="عملة التحويل" htmlFor="walletCurrency" required>
                <select
                  id="walletCurrency"
                  className="input"
                  value={transferForm.currency}
                  onChange={(event) => setTransferForm((prev) => ({ ...prev, currency: event.target.value }))}
                >
                  <option value="LYD">الدينار الليبي (LYD)</option>
                  <option value="USD">الدولار الأمريكي (USD)</option>
                </select>
              </Field>
              <Field label="المبلغ المحوّل" htmlFor="walletAmount" required>
                <input
                  id="walletAmount"
                  className="input"
                  type="number"
                  min="0.001"
                  step={transferForm.currency === 'LYD' ? '0.001' : '0.01'}
                  value={transferForm.amount}
                  onChange={(event) => setTransferForm((prev) => ({ ...prev, amount: event.target.value }))}
                  placeholder={transferForm.currency === 'LYD' ? 'مثال: 25.500' : 'Example: 10.00'}
                  required
                />
              </Field>
            </div>
            <Field label="مرجع الحوالة" htmlFor="walletReference" hint="أدخله كما يظهر في إيصال التحويل." required>
              <input
                id="walletReference"
                className="input"
                value={transferForm.paymentReference}
                onChange={(event) => setTransferForm((prev) => ({ ...prev, paymentReference: event.target.value }))}
                minLength={4}
                maxLength={100}
                required
              />
            </Field>
            <Field label="ملاحظة (اختيارية)" htmlFor="walletNote">
              <input
                id="walletNote"
                className="input"
                value={transferForm.note}
                onChange={(event) => setTransferForm((prev) => ({ ...prev, note: event.target.value }))}
                maxLength={500}
              />
            </Field>
            <button type="submit" className="btn btn-primary btn-sm" disabled={sendingTransfer}>
              {sendingTransfer ? <Spinner size={15} /> : <Icon name="send" size={15} />} إرسال طلب مراجعة التحويل
            </button>
          </form>
          <div className="alert alert-info" style={{ marginTop: 12 }}>
            <Icon name="info" size={15} />
            <span>لا تضف طلباً قبل تنفيذ التحويل إلى بيانات الدفع التي زودتك بها الإدارة. لا يضاف أي رصيد تلقائياً؛ تحدد الإدارة نقاط الاستخدام بعد التحقق.</span>
          </div>
          <h3 style={{ fontSize: '0.95rem', marginTop: 18 }}>طلبات التحويل الأخيرة</h3>
          {walletData?.paymentRequests?.length ? (
            <ul className="plan-mini">
              {walletData.paymentRequests.slice(0, 5).map((item) => (
                <li key={item.id}>
                  <span>{item.currency === 'LYD' ? 'دينار ليبي' : 'دولار أمريكي'} · {formatNumber(item.amount)} · {item.paymentReference}</span>
                  <span className={`badge ${item.status === 'approved' ? 'badge-success' : item.status === 'rejected' ? 'badge-danger' : 'badge-warning'}`}>
                    {item.status === 'approved' ? 'معتمد' : item.status === 'rejected' ? 'مرفوض' : 'قيد المراجعة'}
                  </span>
                </li>
              ))}
            </ul>
          ) : <p className="small faint">لا توجد طلبات تحويل بعد.</p>}
        </section>

        <section className="card card-pad">
          <h2 className="section-title" style={{ margin: '0 0 12px', fontSize: '1.05rem' }}>
            <Icon name="lock" size={17} /> كلمة المرور
          </h2>
          <form onSubmit={savePassword}>
            <Field label="كلمة المرور الحالية" htmlFor="currentPassword" error={passwordErrors.currentPassword} required>
              <input
                id="currentPassword"
                className="input"
                type="password"
                autoComplete="current-password"
                value={passwords.currentPassword}
                onChange={(event) => setPasswords((prev) => ({ ...prev, currentPassword: event.target.value }))}
              />
            </Field>
            <Field label="كلمة المرور الجديدة" htmlFor="newPassword" hint="٨ أحرف على الأقل، مع حرف ورقم." error={passwordErrors.newPassword} required>
              <input
                id="newPassword"
                className="input"
                type="password"
                autoComplete="new-password"
                value={passwords.newPassword}
                onChange={(event) => setPasswords((prev) => ({ ...prev, newPassword: event.target.value }))}
              />
            </Field>
            <Field label="تأكيد كلمة المرور" htmlFor="confirm" error={passwordErrors.confirm} required>
              <input
                id="confirm"
                className="input"
                type="password"
                autoComplete="new-password"
                value={passwords.confirm}
                onChange={(event) => setPasswords((prev) => ({ ...prev, confirm: event.target.value }))}
              />
            </Field>
            <button type="submit" className="btn btn-primary btn-sm btn-block" disabled={savingPassword}>
              {savingPassword ? <Spinner size={15} /> : <Icon name="shield" size={15} />} تحديث كلمة المرور
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
