import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { auth, studio } from './api.js';

const EMPTY = { loading: true, user: null, entitlements: null, tools: [], providers: null };

const SessionContext = createContext(null);

export function SessionProvider({ children }) {
  const [state, setState] = useState(EMPTY);
  const [plans, setPlans] = useState([]);

  const apply = useCallback((data) => {
    setState({
      loading: false,
      user: data?.user ?? null,
      entitlements: data?.entitlements ?? null,
      tools: data?.tools ?? [],
      providers: data?.providers ?? null,
    });
  }, []);

  const refresh = useCallback(async () => {
    try {
      apply(await auth.me());
    } catch (err) {
      if (err.status === 401) {
        setState({ loading: false, user: null, entitlements: null, tools: [], providers: null });
      } else {
        setState((prev) => ({ ...prev, loading: false }));
      }
    }
  }, [apply]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    studio
      .plans()
      .then((data) => setPlans(data.plans || []))
      .catch(() => setPlans([]));
  }, []);

  const login = useCallback(
    async (email, password) => {
      const data = await auth.login(email, password);
      apply(data);
      return data;
    },
    [apply]
  );

  const register = useCallback(
    async (payload) => {
      const data = await auth.register(payload);
      apply(data);
      return data;
    },
    [apply]
  );

  const logout = useCallback(async () => {
    try {
      await auth.logout();
    } finally {
      setState({ loading: false, user: null, entitlements: null, tools: [], providers: null });
    }
  }, []);

  const setEntitlements = useCallback((entitlements) => {
    setState((prev) => (entitlements ? { ...prev, entitlements } : prev));
  }, []);

  const value = useMemo(
    () => ({ ...state, plans, login, register, logout, refresh, setEntitlements }),
    [state, plans, login, register, logout, refresh, setEntitlements]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}
