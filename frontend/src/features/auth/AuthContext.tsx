import { createContext, createElement, useContext, useEffect, useState, type ReactNode } from "react";
import { ApiError, api, getTelegramWebApp, getToken, setToken } from "../../api/client";
import type { User } from "../../api/types";

type AuthState =
  | { status: "loading" }
  | { status: "anonymous"; reason: string }
  | { status: "needs_profile"; user: User; tgFirstName: string | null }
  | { status: "ready"; user: User };

const AuthContext = createContext<{ state: AuthState; initData: string; refresh: () => void } | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("AuthProvider missing");
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });
  const [initData, setInitData] = useState("");
  const [nonce, setNonce] = useState(0);
  const refresh = () => setNonce((n) => n + 1);

  useEffect(() => {
    (async () => {
      try {
        const tg = getTelegramWebApp();
        tg?.ready();
        tg?.expand();
        let data = tg?.initData ?? "";
        for (let i = 0; i < 10 && !data; i++) {
          await new Promise((r) => setTimeout(r, 100));
          data = getTelegramWebApp()?.initData ?? "";
        }
        if (data) setInitData(data);

        // If we already have a token (e.g. after dev-bypass registration in a browser),
        // verify it with /me before falling back to Telegram initData.
        const tgUser = tg?.initDataUnsafe?.user;
        if (getToken()) {
          const user = await api.me();
          if (tgUser && user.telegram_id !== tgUser.id) {
            setToken(null);
          } else if (user.role !== "admin" && (!user.first_name || !user.phone)) {
            setState({ status: "needs_profile", user, tgFirstName: tg?.initDataUnsafe?.user?.first_name ?? user.first_name });
            return;
          }
          setState({ status: "ready", user });
          return;
        }

        if (!data) {
          setState({ status: "anonymous", reason: "Откройте приложение из Telegram (кнопка бота/меню). В браузере авторизация недоступна." });
          return;
        }
        const auth = await api.authTelegram(data);
        setToken(auth.access_token);
        const user = auth.user;
        if (!user.first_name || !user.phone) {
          setState({ status: "needs_profile", user, tgFirstName: tg?.initDataUnsafe?.user?.first_name ?? user.first_name });
          return;
        }
        setState({ status: "ready", user });
      } catch (e) {
        setToken(null);
        const tg = getTelegramWebApp();
        const data = tg?.initData ?? "";
        if (data) setInitData(data);
        if (e instanceof ApiError && e.status === 403) {
          const detail = e.detail as { code?: string; message?: string } | string;
          const code = typeof detail === "object" ? detail.code : null;
          const message = typeof detail === "object" ? detail.message : String(detail);
          if (code === "registration_required") {
            setState({ status: "anonymous", reason: message || "Введите код приглашения от администратора." });
            return;
          }
        }
        try {
          if (!data) { setState({ status: "anonymous", reason: "Нет данных Telegram. Откройте Mini App из Telegram." }); return; }
          const auth = await api.authTelegram(data);
          setToken(auth.access_token);
          const user = auth.user;
          if (user.role !== "admin" && (!user.first_name || !user.phone)) {
            setState({ status: "needs_profile", user, tgFirstName: tg?.initDataUnsafe?.user?.first_name ?? user.first_name });
            return;
          }
          setState({ status: "ready", user });
        } catch (e2) {
          if (e2 instanceof ApiError && e2.status === 403) {
            const detail = e2.detail as { code?: string; message?: string } | string;
            const message = typeof detail === "object" ? detail.message : String(detail);
            setState({ status: "anonymous", reason: message || "Доступ выдаётся администратором." });
          } else {
            setState({ status: "anonymous", reason: `Не удалось войти: ${e2 instanceof Error ? e2.message : "ошибка"}` });
          }
        }
      }
    })();
  }, [nonce]);

  return createElement(AuthContext.Provider, { value: { state, initData, refresh } }, children);
}

export function useAuthState() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("AuthProvider missing");
  return ctx.state;
}

export function useAuthInitData() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("AuthProvider missing");
  return ctx.initData;
}
