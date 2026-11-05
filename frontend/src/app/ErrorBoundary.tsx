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
        <main className="app no-tabs">
          <div className="empty"><div className="big">⚠️</div><h2>Ошибка приложения</h2></div>
          <section className="card">
            <p>Не удалось загрузить интерфейс. Обновите Mini App или откройте его из Telegram заново.</p>
            <pre className="muted small" style={{ whiteSpace: "pre-wrap", margin: 0 }}>{this.state.error.message}</pre>
            <button className="btn btn-primary btn-block" onClick={() => window.location.reload()}>Перезагрузить</button>
          </section>
        </main>
      );
    }
    return this.props.children;
  }
}
