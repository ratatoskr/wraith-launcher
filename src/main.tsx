import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// In a browser with ?mock, for working on the UI without the app. Left out of real builds
if (import.meta.env.DEV && new URLSearchParams(location.search).has("mock")) {
  const { installMock } = await import("./dev/mock");
  installMock();
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
