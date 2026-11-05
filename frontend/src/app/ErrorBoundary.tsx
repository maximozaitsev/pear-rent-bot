import React from "react";

type State = { error: Error | null };

export class ErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("Mini App error", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <main className="app">
          <h1>Ошибка приложения</h1>
          <section className="card">
            <p>Не удалось загрузить интерфейс. Обновите Mini App или откройте его из Telegram заново.</p>
            <pre className="muted" style={{ whiteSpace: "pre-wrap" }}>
              {this.state.error.message}
            </pre>
          </section>
        </main>
      );
    }
    return this.props.children;
  }
}
