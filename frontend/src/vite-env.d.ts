/// <reference types="vite/client" />

interface TelegramWebApp {
  initData: string;
  initDataUnsafe?: { start_param?: string; user?: { id: number } };
  ready: () => void;
  expand: () => void;
  close?: () => void;
}

interface Window {
  Telegram?: { WebApp?: TelegramWebApp };
}
