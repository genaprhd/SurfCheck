import { config } from './config.js';
import { configureRefreshInterval, startRefresh } from './forecast.js';
import { createServer } from './server.js';
import { loadSavedSpots } from './spots.js';

const server = createServer();

await loadSavedSpots();
await server.listen({ host: config.host, port: config.port });
server.log.info(`Surf Check API listening on ${config.host}:${config.port}`);
startRefresh();
const refreshInterval = configureRefreshInterval();

const shutdown = async (signal: string): Promise<void> => {
  server.log.info(`Received ${signal}, shutting down`);
  clearInterval(refreshInterval);
  await server.close();
  process.exit(0);
};

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
