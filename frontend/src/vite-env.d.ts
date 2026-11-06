/// <reference types="vite/client" />

interface TelegramWebApp {
  initData: string;
  initDataUnsafe?: { user?: { id: number; username?: string; first_name?: string; last_name?: string } };
  ready: () => void;
  expand: () => void;
  close?: () => void;
}

interface Window {
  Telegram?: { WebApp?: TelegramWebApp };
}
