import { createContext, createElement, useContext, useEffect, useState, type ReactNode } from "react";
import { ApiError, api, getInviteToken, getTelegramWebApp, getToken, setToken } from "../../api/client";
import type { User } from "../../api/types";

type AuthState =
  | { status: "loading" }
  | { status: "anonymous"; reason: string; inviteToken: string | null }
  | { status: "ready"; user: User };

const AuthContext = createContext<{ state: AuthState; refresh: () => void } | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("AuthProvider missing");
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });
  const [nonce, setNonce] = useState(0);
  const refresh = () => setNonce((n) => n + 1);

  useEffect(() => {
    const tg = getTelegramWebApp();
    tg?.ready();
    tg?.expand();
    const initData = tg?.initData;
    const inviteToken = getInviteToken();
    if (!initData) {
      setState({ status: "anonymous", reason: "Откройте приложение внутри Telegram.", inviteToken });
      return;
    }
    (async () => {
      try {
        if (!getToken()) {
          const auth = await api.authTelegram(initData, tg?.initDataUnsafe?.start_param ?? inviteToken);
          setToken(auth.access_token);
          setState({ status: "ready", user: auth.user });
          return;
        }
        const user = await api.me();
        setState({ status: "ready", user });
      } catch (e) {
        setToken(null);
        if (e instanceof ApiError && e.status === 403) {
          const detail = e.detail as { code?: string; message?: string } | string;
          const code = typeof detail === "object" ? detail.code : null;
          const message = typeof detail === "object" ? detail.message : String(detail);
          if (code === "registration_required") {
            setState({ status: "anonymous", reason: message || "Нужна регистрация по приглашению.", inviteToken });
            return;
          }
        }
        try {
          const auth = await api.authTelegram(initData, tg?.initDataUnsafe?.start_param ?? inviteToken);
          setToken(auth.access_token);
          setState({ status: "ready", user: auth.user });
        } catch (e2) {
          if (e2 instanceof ApiError && e2.status === 403) {
            const detail = e2.detail as { code?: string; message?: string } | string;
            const message = typeof detail === "object" ? detail.message : String(detail);
            setState({ status: "anonymous", reason: message || "Доступ выдаётся администратором.", inviteToken });
          } else {
            setState({ status: "anonymous", reason: e2 instanceof Error ? e2.message : "Ошибка авторизации", inviteToken });
          }
        }
      }
    })();
  }, [nonce]);

  return createElement(AuthContext.Provider, { value: { state, refresh } }, children);
}
