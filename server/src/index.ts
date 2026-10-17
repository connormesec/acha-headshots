import { createApp } from "./app";
import { loadConfig } from "./config";

const config = loadConfig();
const { app } = await createApp(config);

if (!config.adminPassword) console.warn("ADMIN_PASSWORD is not set: admin login and AI help are off.");
else if (config.sessionSecretIsRandom) console.warn("SESSION_SECRET is not set: admins are logged out whenever the server restarts.");
if (config.visionProvider === "openai" && !config.openaiApiKey) console.warn("VISION_PROVIDER=openai but OPENAI_API_KEY is not set: AI help is off.");
if (config.visionProvider !== "none" && !config.dataDir) console.warn("DATA_DIR is not set: AI spending is only tracked until the server restarts.");

app.listen(config.port, () => {
  console.log(`ACHA Photo Tools on http://localhost:${config.port} (AI help: ${config.visionProvider}, spending caps $${config.dailyCapUsd}/day, $${config.monthlyCapUsd}/month)`);
});
