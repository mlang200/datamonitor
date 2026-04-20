export interface AppConfig {
  port: number;
  bblSocketUrl: string;
  bblSocketApiKey: string;
  planningDeskApiUrl: string;
  planningDeskApiKey: string;
  sessionSecret: string;
}

export function loadConfig(): AppConfig {
  const missing: string[] = [];

  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret) {
    missing.push('SESSION_SECRET');
  }

  const bblSocketApiKey = process.env.BBL_SOCKET_API_KEY;
  if (!bblSocketApiKey) {
    missing.push('BBL_SOCKET_API_KEY');
  }

  const planningDeskApiKey = process.env.PLANNING_DESK_API_KEY;
  if (!planningDeskApiKey) {
    missing.push('PLANNING_DESK_API_KEY');
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(', ')}. ` +
      `Set them before starting the server.`
    );
  }

  return {
    port: parseInt(process.env.PORT || '3001', 10),
    bblSocketUrl: process.env.BBL_SOCKET_URL || 'https://api.bbl.scb.world',
    bblSocketApiKey: bblSocketApiKey!,
    planningDeskApiUrl: process.env.PLANNING_DESK_API_URL || 'https://api.desk.dyn.sport/planning/api',
    planningDeskApiKey: planningDeskApiKey!,
    sessionSecret: sessionSecret!,
  };
}
