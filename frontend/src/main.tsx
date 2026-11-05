import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app/App";
import { AuthProvider } from "./features/auth/AuthContext";
import { ErrorBoundary } from "./app/ErrorBoundary";
import "./styles/index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);

