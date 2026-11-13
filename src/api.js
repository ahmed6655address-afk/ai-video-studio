const JSON_HEADERS = {
  'content-type': 'application/json',
  'x-requested-with': 'ai-video-studio',
};

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data || {};
    this.fields = data?.fields || null;
    this.code = data?.error || null;
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  let response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: 'include',
      headers: JSON_HEADERS,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('تعذّر الاتصال بالخادم. تحقّق من الشبكة وحاول مجددًا.', 0, {});
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(data.messageAr || 'تعذّر إتمام الطلب. حاول مرة أخرى.', response.status, data);
  }
  return data;
}

export const auth = {
  me: () => api('/auth/me'),
  login: (email, password) => api('/auth/login', { method: 'POST', body: { email, password } }),
  register: (payload) => api('/auth/register', { method: 'POST', body: payload }),
  logout: () => api('/auth/logout', { method: 'POST', body: {} }),
  updateProfile: (payload) => api('/auth/me', { method: 'PATCH', body: payload }),
  changePassword: (payload) => api('/auth/me/password', { method: 'POST', body: payload }),
};

export const wallet = {
  summary: () => api('/wallet'),
  requestTransfer: (payload) => api('/wallet/payment-requests', { method: 'POST', body: payload }),
};

export const studio = {
  dashboard: () => api('/dashboard'),
  tools: () => api('/tools'),
  plans: () => api('/plans'),
  createProject: (payload) => api('/projects', { method: 'POST', body: payload }),
  projects: (query = '') => api(`/projects${query}`),
  project: (id) => api(`/projects/${id}`),
  deleteProject: (id) => api(`/projects/${id}`, { method: 'DELETE' }),
};

export const admin = {
  overview: () => api('/admin/overview'),
  users: (q = '') => api(`/admin/users${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  updateUser: (id, payload) => api(`/admin/users/${id}`, { method: 'PATCH', body: payload }),
  grantSubscription: (id, payload) => api(`/admin/users/${id}/subscription`, { method: 'POST', body: payload }),
  cancelSubscription: (id) => api(`/admin/users/${id}/subscription`, { method: 'DELETE' }),
  plans: () => api('/admin/plans'),
  updatePlan: (code, payload) => api(`/admin/plans/${code}`, { method: 'PATCH', body: payload }),
  payments: (status = 'pending') => api(`/admin/payments?status=${encodeURIComponent(status)}`),
  approvePayment: (id, payload) => api(`/admin/payments/${id}/approve`, { method: 'POST', body: payload }),
  rejectPayment: (id, payload) => api(`/admin/payments/${id}/reject`, { method: 'POST', body: payload }),
};
