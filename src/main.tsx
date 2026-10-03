import React from "react";
import ReactDOM from "react-dom/client";
// Self-hosted fonts: the page makes no third-party requests.
import "@fontsource/barlow/400.css";
import "@fontsource/barlow/500.css";
import "@fontsource/barlow/600.css";
import "@fontsource/graduate/400.css";
import "@fontsource/saira-condensed/500.css";
import "@fontsource/saira-condensed/600.css";
import "@fontsource/saira-condensed/700.css";
import { App } from "./App";
import { BatchProvider } from "./state/BatchContext";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BatchProvider>
      <App />
    </BatchProvider>
  </React.StrictMode>,
);
