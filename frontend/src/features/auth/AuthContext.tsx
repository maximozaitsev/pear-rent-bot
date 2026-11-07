import { createContext, createElement, useContext, useEffect, useState, type ReactNode } from "react";
import { ApiError, api, getTelegramInitData, getTelegramWebApp, getToken, setToken } from "../../api/client";
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

async function collectInitData(): Promise<string> {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    const data = getTelegramInitData();
    if (data) return data;
    await new Promise((r) => setTimeout(r, 150));
  }
  return getTelegramInitData();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });
  const [initData, setInitData] = useState("");
  const [nonce, setNonce] = useState(0);
  const refresh = () => { setState({ status: "loading" }); setNonce((n) => n + 1); };

  useEffect(() => {
    (async () => {
      try {
        const tg = getTelegramWebApp();
        tg?.ready();
        tg?.expand();
        const data = await collectInitData();
        if (data) setInitData(data);

        const tgUser = tg?.initDataUnsafe?.user;
        if (getToken()) {
          try {
            const user = await api.me();
            if (tgUser && user.telegram_id !== tgUser.id) {
              setToken(null);
            } else if (user.role !== "admin" && (!user.first_name || !user.phone)) {
              setState({ status: "needs_profile", user, tgFirstName: tg?.initDataUnsafe?.user?.first_name ?? user.first_name });
              return;
            } else {
              setState({ status: "ready", user });
              return;
            }
          } catch {
            setToken(null);
          }
        }

        if (!data) {
          setState({ status: "anonymous", reason: "Не удалось получить данные Telegram для входа. Нажмите «Повторить вход». Если не помогло — откройте приложение через меню бота." });
          return;
        }
        const auth = await api.authTelegram(data);
        setToken(auth.access_token);
        const user = auth.user;
        if (user.role !== "admin" && (!user.first_name || !user.phone)) {
          setState({ status: "needs_profile", user, tgFirstName: tg?.initDataUnsafe?.user?.first_name ?? user.first_name });
          return;
        }
        setState({ status: "ready", user });
      } catch (e) {
        setToken(null);
        const data = getTelegramInitData() || initData;
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
          if (!data) { setState({ status: "anonymous", reason: "Не удалось получить данные Telegram. Нажмите «Повторить вход»." }); return; }
          const auth = await api.authTelegram(data);
          setToken(auth.access_token);
          const user = auth.user;
          if (user.role !== "admin" && (!user.first_name || !user.phone)) {
            setState({ status: "needs_profile", user, tgFirstName: getTelegramWebApp()?.initDataUnsafe?.user?.first_name ?? user.first_name });
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
