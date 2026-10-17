import { defineConfig } from 'prisma/config';
import { readDatabaseEnvironment } from './src/server/Env.js';
import { loadEnvironmentValues } from './src/server/LoadEnvironment.js';

const env = readDatabaseEnvironment(loadEnvironmentValues(process.env));
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: env.DATABASE_URL },
});
