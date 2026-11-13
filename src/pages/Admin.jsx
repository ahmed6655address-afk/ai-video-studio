import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '../components/Icon.jsx';
import {
  ConnectionBadge,
  EmptyState,
  Field,
  Modal,
  Progress,
  Spinner,
  Stat,
  accentOf,
  formatDate,
  formatNumber,
  initials,
  statusMeta,
  timeAgo,
  useToast,
} from '../components/ui.jsx';
import { admin } from '../api.js';
import { useSession } from '../session.jsx';

const TABS = [
  { id: 'overview', label: 'نظرة عامة', icon: 'grid' },
  { id: 'users', label: 'المستخدمون', icon: 'users' },
  { id: 'plans', label: 'الخطط', icon: 'credit' },
  { id: 'payments', label: 'طلبات التحويل', icon: 'wallet' },
];

const TOOL_LABELS = {
  text_video: 'النص إلى فيديو',
  image_video: 'الصورة إلى فيديو',
  voice: 'الصوت العربي',
  cartoon: 'الكرتون',
};

const ROLE_LABELS = { owner: 'المالك', admin: 'مشرف', user: 'مستخدم' };

const MONTH_OPTIONS = [1, 3, 6, 12];

export default function Admin() {
  const { user, tools } = useSession();
  const toast = useToast();
  const [tab, setTab] = useState('overview');

  const [overview, setOverview] = useState(null);
  const [loadingOverview, setLoadingOverview] = useState(true);

  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState('');
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [busyUser, setBusyUser] = useState(null);

  const [plans, setPlans] = useState([]);
  const [loadingPlans, setLoadingPlans] = useState(true);

  const [subTarget, setSubTarget] = useState(null);
  const [subForm, setSubForm] = useState({ planCode: 'pro', months: 1, paymentRef: '', currency: 'LYD', amount: '', paymentVerified: false, verificationNote: '' });
  const [subSaving, setSubSaving] = useState(false);

  const [limitsTarget, setLimitsTarget] = useState(null);
  const [limitsDraft, setLimitsDraft] = useState({});
  const [limitsSaving, setLimitsSaving] = useState(false);

  const [planDraft, setPlanDraft] = useState(null);
  const [planSaving, setPlanSaving] = useState(false);

  const [payments, setPayments] = useState([]);
  const [paymentStatus, setPaymentStatus] = useState('pending');
  const [loadingPayments, setLoadingPayments] = useState(false);
  const [paymentDrafts, setPaymentDrafts] = useState({});

  const loadOverview = useCallback(async () => {
    setLoadingOverview(true);
    try {
      const data = await admin.overview();
      setOverview(data);
    } catch (err) {
      toast.push(err.message, 'error');
    } finally {
      setLoadingOverview(false);
    }
  }, [toast]);

  const loadUsers = useCallback(async (q = '') => {
    setLoadingUsers(true);
    try {
      const data = await admin.users(q);
      setUsers(data.users || []);
    } catch (err) {
      toast.push(err.message, 'error');
    } finally {
      setLoadingUsers(false);
    }
  }, [toast]);

  const loadPlans = useCallback(async () => {
    setLoadingPlans(true);
    try {
      const data = await admin.plans();
      setPlans(data.plans || []);
      if (data.plans?.length) {
        setSubForm((prev) => ({
          ...prev,
          planCode: data.plans.some((plan) => plan.code === prev.planCode)
            ? prev.planCode
            : data.plans.find((plan) => plan.code !== 'free' && (plan.prices?.LYD != null || plan.prices?.USD != null))?.code || data.plans[0].code,
        }));
      }
    } catch (err) {
      toast.push(err.message, 'error');
    } finally {
      setLoadingPlans(false);
    }
  }, [toast]);

  const loadPayments = useCallback(async () => {
    if (user?.role !== 'owner') return;
    setLoadingPayments(true);
    try {
      const data = await admin.payments(paymentStatus);
      setPayments(data.payments || []);
    } catch (err) {
      toast.push(err.message, 'error');
    } finally {
      setLoadingPayments(false);
    }
  }, [paymentStatus, toast, user?.role]);

  useEffect(() => {
    loadOverview();
    loadUsers();
    loadPlans();
    if (user?.role === 'owner') loadPayments();
  }, [loadOverview, loadUsers, loadPlans, loadPayments, user?.role]);

  useEffect(() => {
    const timer = setTimeout(() => loadUsers(search.trim()), 320);
    return () => clearTimeout(timer);
  }, [search, loadUsers]);

  const assignablePlans = useMemo(
    () => plans.filter((plan) => plan.isActive !== false && plan.code !== 'free' && (plan.prices?.LYD != null || plan.prices?.USD != null)),
    [plans]
  );

  async function patchUser(target, payload, successMessage) {
    setBusyUser(target.id);
    try {
      await admin.updateUser(target.id, payload);
      toast.push(successMessage, 'success');
      await Promise.all([loadUsers(search.trim()), loadOverview()]);
    } catch (err) {
      toast.push(err.message, 'error');
    } finally {
      setBusyUser(null);
    }
  }

  async function toggleStatus(target) {
    const next = target.status === 'suspended' ? 'active' : 'suspended';
    await patchUser(
      target,
      { status: next },
      next === 'suspended' ? 'تم إيقاف الحساب وإنهاء جلساته.' : 'تم تفعيل الحساب.'
    );
  }

  async function toggleRole(target) {
    const next = target.role === 'admin' ? 'user' : 'admin';
    await patchUser(target, { role: next }, next === 'admin' ? 'تم ترقية المستخدم إلى مشرف.' : 'تم إلغاء صلاحية الإشراف.');
  }

  function openSubscription(target) {
    const plan = assignablePlans.find((item) => item.prices?.LYD != null) ||
      assignablePlans.find((item) => item.prices?.USD != null) || assignablePlans[0];
    const currency = plan?.prices?.LYD != null ? 'LYD' : 'USD';
    setSubTarget(target);
    setSubForm({
      planCode: plan?.code || '',
      months: 1,
      paymentRef: '',
      currency,
      amount: plan?.prices?.[currency] == null ? '' : String(plan.prices[currency]),
      paymentVerified: false,
      verificationNote: '',
    });
  }

  async function grantSubscription(event) {
    event.preventDefault();
    if (!subTarget) return;
    setSubSaving(true);
    try {
      await admin.grantSubscription(subTarget.id, {
        planCode: subForm.planCode,
        months: Number(subForm.months),
        paymentRef: subForm.paymentRef.trim(),
        currency: subForm.currency,
        amount: subForm.amount,
        paymentVerified: subForm.paymentVerified,
        verificationNote: subForm.verificationNote.trim(),
      });
      toast.push('تم تفعيل الاشتراك بنجاح.', 'success');
      setSubTarget(null);
      await Promise.all([loadUsers(search.trim()), loadOverview()]);
    } catch (err) {
      toast.push(err.message, 'error');
    } finally {
      setSubSaving(false);
    }
  }

  async function revokeSubscription(target) {
    setBusyUser(target.id);
    try {
      await admin.cancelSubscription(target.id);
      toast.push('تم إلغاء الاشتراك.', 'success');
      await Promise.all([loadUsers(search.trim()), loadOverview()]);
    } catch (err) {
      toast.push(err.message, 'error');
    } finally {
      setBusyUser(null);
    }
  }

  async function reviewPayment(payment, decision) {
    const draft = paymentDrafts[payment.id] || {};
    const note = String(draft.note || '').trim();
    if (note.length < 8) {
      toast.push('أدخل ملاحظة مراجعة لا تقل عن 8 أحرف.', 'error');
      return;
    }
    try {
      if (decision === 'approve') {
        const credits = Number(draft.credits);
        if (!Number.isSafeInteger(credits) || credits < 1) {
          toast.push('أدخل عدد نقاط استخدام صحيحًا.', 'error');
          return;
        }
        await admin.approvePayment(payment.id, { credits, verificationNote: note });
        toast.push('تم اعتماد الحوالة وإضافة نقاط الاستخدام.', 'success');
      } else {
        await admin.rejectPayment(payment.id, { reviewNote: note });
        toast.push('تم رفض طلب التحويل وحفظ السبب.', 'success');
      }
      await loadPayments();
    } catch (err) {
      toast.push(err.message, 'error');
    }
  }

  function updatePaymentDraft(id, field, value) {
    setPaymentDrafts((prev) => ({
      ...prev,
      [id]: { ...(prev[id] || {}), [field]: value },
    }));
  }

  function changeSubPlan(planCode) {
    const plan = assignablePlans.find((item) => item.code === planCode);
    const currency = plan?.prices?.[subForm.currency] != null
      ? subForm.currency
      : plan?.prices?.LYD != null ? 'LYD' : 'USD';
    const monthly = plan?.prices?.[currency];
    setSubForm((prev) => ({
      ...prev,
      planCode,
      currency,
      amount: monthly == null ? '' : String(Number(monthly) * Number(prev.months || 1)),
    }));
  }

  function changeSubCurrency(currency) {
    const plan = assignablePlans.find((item) => item.code === subForm.planCode);
    const monthly = plan?.prices?.[currency];
    setSubForm((prev) => ({
      ...prev,
      currency,
      amount: monthly == null ? '' : String(Number(monthly) * Number(prev.months || 1)),
    }));
  }

  function openLimits(target) {
    setLimitsTarget(target);
    const draft = {};
    for (const tool of Object.keys(TOOL_LABELS)) {
      draft[tool] = String(
        target.customLimits?.[tool] ?? target.entitlements?.limits?.[tool] ?? 0
      );
    }
    setLimitsDraft(draft);
  }

  async function saveLimits(event) {
    event.preventDefault();
    if (!limitsTarget) return;
    setLimitsSaving(true);
    try {
      const payload = {};
      for (const [tool, value] of Object.entries(limitsDraft)) {
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed >= 0) payload[tool] = Math.floor(parsed);
      }
      await admin.updateUser(limitsTarget.id, { customLimits: payload });
      toast.push('تم تحديث حدود الاستخدام.', 'success');
      setLimitsTarget(null);
      await loadUsers(search.trim());
    } catch (err) {
      toast.push(err.message, 'error');
    } finally {
      setLimitsSaving(false);
    }
  }

  async function resetLimits() {
    if (!limitsTarget) return;
    setLimitsSaving(true);
    try {
      await admin.updateUser(limitsTarget.id, { customLimits: null });
      toast.push('تمت إعادة الحدود إلى إعدادات الخطة.', 'success');
      setLimitsTarget(null);
      await loadUsers(search.trim());
    } catch (err) {
      toast.push(err.message, 'error');
    } finally {
      setLimitsSaving(false);
    }
  }

  function startEditPlan(plan) {
    setPlanDraft({
      code: plan.code,
      nameAr: plan.nameAr,
      taglineAr: plan.taglineAr || '',
      priceLyd: plan.prices?.LYD == null ? '' : String(plan.prices.LYD),
      priceUsd: plan.prices?.USD == null ? '' : String(plan.prices.USD),
      isActive: plan.isActive !== false,
      limits: { ...(plan.limits || {}) },
    });
  }

  async function savePlan(event) {
    event.preventDefault();
    if (!planDraft) return;
    setPlanSaving(true);
    try {
      const limits = {};
      for (const [tool, value] of Object.entries(planDraft.limits)) {
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed >= 0) limits[tool] = Math.floor(parsed);
      }
      await admin.updatePlan(planDraft.code, {
        nameAr: planDraft.nameAr.trim(),
        taglineAr: planDraft.taglineAr.trim(),
        priceLyd: planDraft.priceLyd === '' ? 0 : Number(planDraft.priceLyd),
        priceUsd: planDraft.priceUsd === '' ? 0 : Number(planDraft.priceUsd),
        isActive: planDraft.isActive,
        limits,
      });
      toast.push('تم تحديث الخطة.', 'success');
      setPlanDraft(null);
      await loadPlans();
    } catch (err) {
      toast.push(err.message, 'error');
    } finally {
      setPlanSaving(false);
    }
  }

  const stats = overview?.stats;
  const providerTools = useMemo(() => {
    const map = overview?.providers?.tools || {};
    return Object.values(map);
  }, [overview]);
  const connectedCount = providerTools.filter((item) => item.connected).length;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">الإدارة</p>
          <h1 className="page-title">لوحة التحكم</h1>
          <p className="muted small">إدارة المستخدمين والاشتراكات وحدود الاستخدام.</p>
        </div>
        <span className="badge badge-violet">
          <Icon name="crown" size={14} /> {ROLE_LABELS[user?.role] || 'مشرف'}
        </span>
      </header>

      <div className="tabs" role="tablist">
        {TABS.filter((item) => item.id !== 'payments' || user?.role === 'owner').map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={`tab${tab === item.id ? ' active' : ''}`}
            onClick={() => setTab(item.id)}
          >
            <Icon name={item.icon} size={16} /> {item.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <section>
          {loadingOverview && !stats ? (
            <div className="card card-pad center"><Spinner /></div>
          ) : (
            <>
              <div className="stats-grid">
                <Stat label="المستخدمون" value={formatNumber(stats?.users ?? 0)} icon="users" accent="violet" />
                <Stat label="اشتراكات نشطة" value={formatNumber(stats?.activeSubscriptions ?? 0)} icon="credit" accent="emerald" />
                <Stat label="المشاريع" value={formatNumber(stats?.projects ?? 0)} icon="film" accent="cyan" />
                <Stat label="طلبات بانتظار المزوّد" value={formatNumber(stats?.pendingProviderRequests ?? 0)} icon="clock" accent="amber" />
              </div>

              <div className="admin-grid">
                <div className="card card-pad">
                  <div className="row-between" style={{ marginBottom: 10 }}>
                    <h2 className="section-title" style={{ margin: 0, fontSize: '1.02rem' }}>
                      <Icon name="film" size={17} /> أحدث المشاريع
                    </h2>
                    <span className="small faint">{formatNumber(stats?.generations ?? 0)} عملية توليد</span>
                  </div>
                  {overview?.recentProjects?.length ? (
                    <div className="list compact">
                      {overview.recentProjects.map((project) => {
                        const meta = statusMeta(project.status);
                        return (
                          <div key={project.id} className="list-row">
                            <div className="grow" style={{ minWidth: 0 }}>
                              <p className="list-title">{project.prompt}</p>
                              <p className="muted small" style={{ margin: '2px 0 0' }}>
                                {project.userName} · {TOOL_LABELS[project.tool] || project.tool} · {timeAgo(project.createdAt)}
                              </p>
                            </div>
                            <span className={`badge badge-${meta.tone}`}><span className="dot" /> {meta.label}</span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="small faint">لا توجد مشاريع بعد.</p>
                  )}
                </div>

                <div className="card card-pad">
                  <h2 className="section-title" style={{ margin: '0 0 10px', fontSize: '1.02rem' }}>
                    <Icon name="plug" size={17} /> حالة المزوّدين
                  </h2>
                  <p className="small muted" style={{ marginTop: 0 }}>
                    {connectedCount === 0
                      ? 'لا يوجد أي مزوّد ذكاء اصطناعي مُهيّأ. المفاتيح تُقرأ من بيئة الخادم فقط.'
                      : `${connectedCount} من ${providerTools.length} أدوات لها مزوّد مُهيّأ على الخادم.`}
                  </p>
                  <div className="provider-list">
                    {providerTools.map((item) => (
                      <div key={item.tool} className="provider-row">
                        <span className="small">{TOOL_LABELS[item.tool] || item.tool}</span>
                        <ConnectionBadge connected={item.connected} />
                      </div>
                    ))}
                  </div>
                  <div className="alert alert-info" style={{ marginTop: 12 }}>
                    <Icon name="alert" size={15} />
                    <span>
                      لتفعيل مزوّد: أضف مفتاحه ونقطة النهاية في متغيّرات بيئة الخادم ثم أعد النشر.
                      لا تُدخل المفاتيح في الواجهة أو في الشيفرة.
                    </span>
                  </div>
                </div>
              </div>

              <div className="card card-pad" style={{ marginTop: 14 }}>
                <h2 className="section-title" style={{ margin: '0 0 10px', fontSize: '1.02rem' }}>
                  <Icon name="users" size={17} /> أحدث المستخدمين
                </h2>
                {overview?.recentUsers?.length ? (
                  <div className="list compact">
                    {overview.recentUsers.map((item) => (
                      <div key={item.id} className="list-row">
                        <span className="avatar sm" style={{ background: accentOf(item.avatarColor).grad }}>
                          {initials(item.name)}
                        </span>
                        <div className="grow">
                          <p className="list-title">{item.name}</p>
                          <p className="muted small" style={{ margin: '2px 0 0' }} dir="ltr">{item.email}</p>
                        </div>
                        <span className="small faint">{formatDate(item.createdAt)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="small faint">لا يوجد مستخدمون بعد.</p>
                )}
              </div>
            </>
          )}
        </section>
      )}

      {tab === 'users' && (
        <section>
          <div className="card card-pad">
            <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
              <div className="grow" style={{ minWidth: 220 }}>
                <div className="input-icon">
                  <Icon name="search" size={16} />
                  <input
                    className="input"
                    placeholder="ابحث بالاسم أو البريد الإلكتروني…"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </div>
              </div>
              <span className="small faint">{users.length} مستخدم</span>
            </div>
          </div>

          {loadingUsers ? (
            <div className="card card-pad center" style={{ marginTop: 14 }}><Spinner /></div>
          ) : users.length ? (
            <div className="list" style={{ marginTop: 14 }}>
              {users.map((item) => {
                const ent = item.entitlements || {};
                const isOwner = item.role === 'owner';
                const isSelf = item.id === user?.id;
                return (
                  <article key={item.id} className="card card-pad user-card">
                    <div className="row-between" style={{ gap: 12, flexWrap: 'wrap' }}>
                      <div className="row" style={{ gap: 12, minWidth: 0 }}>
                        <span className="avatar" style={{ background: accentOf(item.avatarColor).grad }}>
                          {initials(item.name)}
                        </span>
                        <div style={{ minWidth: 0 }}>
                          <p style={{ margin: 0, fontWeight: 700 }}>
                            {item.name}
                            {isSelf && <span className="small faint"> (أنت)</span>}
                          </p>
                          <p className="muted small" style={{ margin: '2px 0 0' }} dir="ltr">{item.email}</p>
                          <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                            <span className={`badge ${isOwner ? 'badge-violet' : item.role === 'admin' ? 'badge-info' : 'badge-default'}`}>
                              {isOwner && <Icon name="crown" size={12} />} {ROLE_LABELS[item.role]}
                            </span>
                            <span className={`badge ${item.status === 'active' ? 'badge-success' : 'badge-danger'}`}>
                              {item.status === 'active' ? 'نشط' : 'موقوف'}
                            </span>
                            {isOwner ? (
                              <span className="badge badge-gold">وصول مجاني دائم</span>
                            ) : item.subscription ? (
                              <span className="badge badge-success">
                                <Icon name="check" size={12} /> {item.subscription.planNameAr} · حتى {formatDate(item.subscription.expiresAt)}
                              </span>
                            ) : (
                              <span className="badge badge-warning">بدون اشتراك</span>
                            )}
                          </div>
                        </div>
                      </div>

                      {!isOwner && (
                        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                          <button type="button" className="btn btn-primary btn-xs" onClick={() => openSubscription(item)}>
                            <Icon name="credit" size={14} /> {item.subscription ? 'تجديد' : 'تفعيل اشتراك'}
                          </button>
                          {item.subscription && (
                            <button
                              type="button"
                              className="btn btn-outline btn-xs"
                              onClick={() => revokeSubscription(item)}
                              disabled={busyUser === item.id}
                            >
                              إلغاء الاشتراك
                            </button>
                          )}
                          <button type="button" className="btn btn-ghost btn-xs" onClick={() => openLimits(item)}>
                            <Icon name="sliders" size={14} /> الحدود
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-xs"
                            onClick={() => toggleRole(item)}
                            disabled={busyUser === item.id || isSelf}
                            title={isSelf ? 'لا يمكنك تعديل صلاحيتك' : ''}
                          >
                            {item.role === 'admin' ? 'إلغاء الإشراف' : 'ترقية لمشرف'}
                          </button>
                          <button
                            type="button"
                            className={`btn btn-xs ${item.status === 'suspended' ? 'btn-outline' : 'btn-danger'}`}
                            onClick={() => toggleStatus(item)}
                            disabled={busyUser === item.id || isSelf}
                          >
                            {item.status === 'suspended' ? 'تفعيل' : 'إيقاف'}
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="usage-grid">
                      {Object.keys(TOOL_LABELS).map((tool) => {
                        const limit = ent.limits?.[tool] ?? 0;
                        const used = item.usage?.[tool] ?? 0;
                        return (
                          <div key={tool}>
                            <div className="row-between small">
                              <span>{TOOL_LABELS[tool]}</span>
                              <span className="muted">
                                {isOwner ? `${formatNumber(used)} / ∞` : `${formatNumber(used)} / ${formatNumber(limit)}`}
                              </span>
                            </div>
                            <Progress value={used} max={isOwner ? Math.max(used, 1) : limit || 1} />
                          </div>
                        );
                      })}
                    </div>
                    <p className="small faint" style={{ margin: '8px 0 0' }}>
                      {formatNumber(item.projects)} مشروع · انضم {formatDate(item.createdAt)}
                      {item.customLimits && ' · حدود مخصّصة مفعّلة'}
                    </p>
                  </article>
                );
              })}
            </div>
          ) : (
            <div style={{ marginTop: 14 }}>
              <EmptyState icon="users" title="لا يوجد مستخدمون مطابقون">جرّب كلمة بحث أخرى.</EmptyState>
            </div>
          )}
        </section>
      )}

      {tab === 'plans' && (
        <section>
          {loadingPlans ? (
            <div className="card card-pad center"><Spinner /></div>
          ) : (
            <div className="plans-grid">
              {plans.map((plan) => (
                <article key={plan.code} className={`card card-pad plan-card${plan.isActive === false ? ' muted-card' : ''}`}>
                  <div className="row-between">
                    <h3 style={{ margin: 0 }}>{plan.nameAr}</h3>
                    <span className="badge badge-default">{plan.code}</span>
                  </div>
                  <p className="muted small" style={{ margin: '4px 0 10px' }}>{plan.taglineAr}</p>
                  <p className="plan-price">
                    {plan.priceSar > 0 ? `${formatNumber(plan.priceSar)} ر.س` : 'مجاني'}
                    <span className="small faint"> / شهريًا</span>
                  </p>
                  <ul className="plan-limits">
                    {Object.keys(TOOL_LABELS).map((tool) => (
                      <li key={tool}>
                        <span>{TOOL_LABELS[tool]}</span>
                        <span className="muted small">{formatNumber(plan.limits?.[tool] ?? 0)} / شهر</span>
                      </li>
                    ))}
                  </ul>
                  <div className="row-between" style={{ marginTop: 10 }}>
                    <span className={`badge ${plan.isActive === false ? 'badge-danger' : 'badge-success'}`}>
                      {plan.isActive === false ? 'معطّلة' : 'متاحة'}
                    </span>
                    <button type="button" className="btn btn-outline btn-xs" onClick={() => startEditPlan(plan)}>
                      <Icon name="edit" size={14} /> تعديل
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
          <div className="alert alert-info" style={{ marginTop: 14 }}>
            <Icon name="alert" size={15} />
            <span>
              الدفع الإلكتروني غير متصل. تفعيل الاشتراكات يتم يدويًا من تبويب المستخدمين بعد استلام
              الدفعة، مع حفظ مرجع الدفع للمراجعة.
            </span>
          </div>
        </section>
      )}

      {tab === 'payments' && user?.role === 'owner' && (
        <section className="card card-pad">
          <div className="row-between" style={{ gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
            <div>
              <h2 className="section-title" style={{ margin: 0 }}>مراجعة التحويلات اليدوية</h2>
              <p className="small muted" style={{ margin: '4px 0 0' }}>لا تعتمد أي طلب قبل مطابقة المرجع والمبلغ فعليًا مع كشف الحساب أو إيصال موثوق.</p>
            </div>
            <select className="input select" style={{ maxWidth: 190 }} value={paymentStatus} onChange={(event) => setPaymentStatus(event.target.value)}>
              <option value="pending">قيد المراجعة</option>
              <option value="approved">معتمدة</option>
              <option value="rejected">مرفوضة</option>
            </select>
          </div>
          {loadingPayments ? <div className="center"><Spinner /></div> : payments.length ? (
            <div className="stack">
              {payments.map((payment) => {
                const draft = paymentDrafts[payment.id] || {};
                return (
                  <article key={payment.id} className="card card-pad" style={{ boxShadow: 'none', border: '1px solid var(--border)' }}>
                    <div className="row-between" style={{ gap: 12, flexWrap: 'wrap' }}>
                      <div>
                        <strong>{payment.userName || 'مستخدم'}</strong>
                        <p className="small muted" style={{ margin: '3px 0' }} dir="ltr">{payment.userEmail}</p>
                      </div>
                      <span className={`badge ${payment.status === 'approved' ? 'badge-success' : payment.status === 'rejected' ? 'badge-danger' : 'badge-warning'}`}>
                        {payment.status === 'approved' ? 'معتمد' : payment.status === 'rejected' ? 'مرفوض' : 'قيد المراجعة'}
                      </span>
                    </div>
                    <div className="meta-list" style={{ marginTop: 10 }}>
                      <div><dt>المبلغ المحوّل</dt><dd>{formatNumber(payment.amount)} {payment.currency === 'LYD' ? 'د.ل' : 'USD'}</dd></div>
                      <div><dt>مرجع الحوالة</dt><dd dir="ltr">{payment.paymentReference}</dd></div>
                      <div><dt>تاريخ الطلب</dt><dd>{formatDate(payment.createdAt)}</dd></div>
                      {payment.customerNote && <div><dt>ملاحظة المستخدم</dt><dd>{payment.customerNote}</dd></div>}
                      {payment.adminNote && <div><dt>ملاحظة الإدارة</dt><dd>{payment.adminNote}</dd></div>}
                    </div>
                    {payment.status === 'pending' && (
                      <div style={{ marginTop: 12 }}>
                        <div className="form-grid">
                          <Field label="نقاط الاستخدام التي ستضاف" htmlFor={`credits-${payment.id}`} required>
                            <input
                              id={`credits-${payment.id}`}
                              className="input"
                              type="number"
                              min="1"
                              step="1"
                              value={draft.credits || ''}
                              onChange={(event) => updatePaymentDraft(payment.id, 'credits', event.target.value)}
                              required
                            />
                          </Field>
                          <Field label="ملاحظة التحقق أو سبب الرفض" htmlFor={`payment-note-${payment.id}`} required>
                            <input
                              id={`payment-note-${payment.id}`}
                              className="input"
                              minLength="8"
                              maxLength="500"
                              value={draft.note || ''}
                              onChange={(event) => updatePaymentDraft(payment.id, 'note', event.target.value)}
                              required
                            />
                          </Field>
                        </div>
                        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                          <button type="button" className="btn btn-primary btn-sm" onClick={() => reviewPayment(payment, 'approve')}>
                            <Icon name="check" size={14} /> اعتماد وإضافة الرصيد
                          </button>
                          <button type="button" className="btn btn-outline btn-sm" onClick={() => reviewPayment(payment, 'reject')}>
                            <Icon name="x" size={14} /> رفض الطلب
                          </button>
                        </div>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          ) : (
            <EmptyState icon="wallet" title="لا توجد طلبات في هذا التصنيف">ستظهر طلبات التحويل هنا بعد إرسالها من صفحة الملف الشخصي.</EmptyState>
          )}
        </section>
      )}

      <Modal
        open={Boolean(subTarget)}
        title={subTarget ? `اشتراك ${subTarget.name}` : ''}
        onClose={() => setSubTarget(null)}
        footer={
          <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSubTarget(null)}>إلغاء</button>
            <button type="submit" form="sub-form" className="btn btn-primary btn-sm" disabled={subSaving || !subForm.planCode}>
              {subSaving ? <Spinner size={15} /> : <Icon name="check" size={15} />} تفعيل الاشتراك
            </button>
          </>
        }
      >
        <form id="sub-form" onSubmit={grantSubscription}>
          <Field label="الخطة" htmlFor="planCode" required>
            <select
              id="planCode"
              className="input select"
              value={subForm.planCode}
              onChange={(event) => setSubForm((prev) => ({ ...prev, planCode: event.target.value }))}
            >
              {assignablePlans.map((plan) => (
                <option key={plan.code} value={plan.code}>
                  {plan.nameAr} — {formatNumber(plan.priceSar)} ر.س
                </option>
              ))}
            </select>
          </Field>
          <Field label="المدة" htmlFor="months" required>
            <select
              id="months"
              className="input select"
              value={subForm.months}
              onChange={(event) => setSubForm((prev) => ({ ...prev, months: event.target.value }))}
            >
              {MONTH_OPTIONS.map((months) => (
                <option key={months} value={months}>{months} شهر</option>
              ))}
            </select>
          </Field>
          <Field label="مرجع الدفع" htmlFor="paymentRef" hint="اختياري — رقم الحوالة أو رقم العملية.">
            <input
              id="paymentRef"
              className="input"
              value={subForm.paymentRef}
              onChange={(event) => setSubForm((prev) => ({ ...prev, paymentRef: event.target.value }))}
              placeholder="مثال: TRX-10293"
            />
          </Field>
          <p className="small faint">سيتم تفعيل الاشتراك فورًا وتُسجَّل العملية في سجل الاشتراكات.</p>
        </form>
      </Modal>

      <Modal
        open={Boolean(limitsTarget)}
        title={limitsTarget ? `حدود الاستخدام — ${limitsTarget.name}` : ''}
        onClose={() => setLimitsTarget(null)}
        footer={
          <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLimitsTarget(null)}>إلغاء</button>
            <button type="button" className="btn btn-outline btn-sm" onClick={resetLimits} disabled={limitsSaving}>
              إعادة لِما في الخطة
            </button>
            <button type="submit" form="limits-form" className="btn btn-primary btn-sm" disabled={limitsSaving}>
              {limitsSaving ? <Spinner size={15} /> : <Icon name="check" size={15} />} حفظ
            </button>
          </>
        }
      >
        <form id="limits-form" onSubmit={saveLimits}>
          <p className="small muted" style={{ marginTop: 0 }}>
            تُطبَّق الحدود المخصّصة على الحساب وتتجاوز حدود الخطة. القيمة 0 تعني منع الاستخدام.
          </p>
          {Object.keys(TOOL_LABELS).map((tool) => (
            <Field key={tool} label={`${TOOL_LABELS[tool]} — حد شهري`} htmlFor={`limit-${tool}`}>
              <input
                id={`limit-${tool}`}
                className="input"
                type="number"
                min="0"
                max="10000"
                value={limitsDraft[tool] ?? ''}
                onChange={(event) => setLimitsDraft((prev) => ({ ...prev, [tool]: event.target.value }))}
              />
            </Field>
          ))}
        </form>
      </Modal>

      <Modal
        open={Boolean(planDraft)}
        title={planDraft ? `تعديل خطة ${planDraft.nameAr}` : ''}
        onClose={() => setPlanDraft(null)}
        footer={
          <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPlanDraft(null)}>إلغاء</button>
            <button type="submit" form="plan-form" className="btn btn-primary btn-sm" disabled={planSaving}>
              {planSaving ? <Spinner size={15} /> : <Icon name="check" size={15} />} حفظ الخطة
            </button>
          </>
        }
      >
        {planDraft && (
          <form id="plan-form" onSubmit={savePlan}>
            <Field label="اسم الخطة" htmlFor="planName" required>
              <input
                id="planName"
                className="input"
                value={planDraft.nameAr}
                onChange={(event) => setPlanDraft((prev) => ({ ...prev, nameAr: event.target.value }))}
              />
            </Field>
            <Field label="الوصف المختصر" htmlFor="planTagline">
              <input
                id="planTagline"
                className="input"
                value={planDraft.taglineAr}
                onChange={(event) => setPlanDraft((prev) => ({ ...prev, taglineAr: event.target.value }))}
              />
            </Field>
            <Field label="السعر الشهري (ر.س)" htmlFor="planPrice" required>
              <input
                id="planPrice"
                className="input"
                type="number"
                min="0"
                step="1"
                value={planDraft.priceSar}
                onChange={(event) => setPlanDraft((prev) => ({ ...prev, priceSar: event.target.value }))}
              />
            </Field>
            {Object.keys(TOOL_LABELS).map((tool) => (
              <Field key={tool} label={`${TOOL_LABELS[tool]} — حد شهري`} htmlFor={`plan-${tool}`}>
                <input
                  id={`plan-${tool}`}
                  className="input"
                  type="number"
                  min="0"
                  max="10000"
                  value={planDraft.limits?.[tool] ?? 0}
                  onChange={(event) =>
                    setPlanDraft((prev) => ({
                      ...prev,
                      limits: { ...prev.limits, [tool]: event.target.value },
                    }))
                  }
                />
              </Field>
            ))}
            <label className="check-row">
              <input
                type="checkbox"
                checked={planDraft.isActive}
                onChange={(event) => setPlanDraft((prev) => ({ ...prev, isActive: event.target.checked }))}
              />
              <span>الخطة متاحة للعرض والاشتراك</span>
            </label>
          </form>
        )}
      </Modal>
    </div>
  );
}
