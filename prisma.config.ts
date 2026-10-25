import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Prisma 7: строка подключения берётся только из окружения (.env), не из schema.prisma.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? 'postgresql://localhost:5432/zayush',
  },
});
