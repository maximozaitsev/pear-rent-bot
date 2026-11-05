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
    (async () => {
      try {
        const tg = getTelegramWebApp();
        tg?.ready();
        tg?.expand();
        const initData = tg?.initData;
        const inviteToken = getInviteToken();
        if (!initData) {
          setState({
            status: "anonymous",
            reason:
              "Откройте приложение из Telegram (кнопка бота/меню). В браузере авторизация недоступна.",
            inviteToken,
          });
          return;
        }
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
        const inviteToken = getInviteToken();
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
          const tg = getTelegramWebApp();
          const initData = tg?.initData;
          if (!initData) {
            setState({ status: "anonymous", reason: "Нет данных Telegram. Откройте Mini App из Telegram.", inviteToken });
            return;
          }
          const auth = await api.authTelegram(initData, tg?.initDataUnsafe?.start_param ?? inviteToken);
          setToken(auth.access_token);
          setState({ status: "ready", user: auth.user });
        } catch (e2) {
          if (e2 instanceof ApiError && e2.status === 403) {
            const detail = e2.detail as { code?: string; message?: string } | string;
            const message = typeof detail === "object" ? detail.message : String(detail);
            setState({ status: "anonymous", reason: message || "Доступ выдаётся администратором.", inviteToken });
          } else {
            const msg = e2 instanceof Error ? e2.message : "Ошибка авторизации";
            setState({ status: "anonymous", reason: `Не удалось войти: ${msg}`, inviteToken });
          }
        }
      }
    })();
  }, [nonce]);

  return createElement(AuthContext.Provider, { value: { state, refresh } }, children);
}
