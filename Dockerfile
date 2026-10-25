# Сборка: docker build -t zayush-pdd .
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/bot/package.json apps/bot/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production WEB_DIST_DIR=/app/apps/web/dist UPLOAD_DIR=/data/uploads PORT=8080
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./
COPY --from=build /app/content ./content
COPY --from=build /app/packages/shared/package.json /app/packages/shared/
COPY --from=build /app/packages/shared/dist /app/packages/shared/dist
COPY --from=build /app/apps/bot/package.json /app/apps/bot/
COPY --from=build /app/apps/bot/dist /app/apps/bot/dist
COPY --from=build /app/apps/api/package.json /app/apps/api/
COPY --from=build /app/apps/api/dist /app/apps/api/dist
COPY --from=build /app/apps/web/dist /app/apps/web/dist
RUN mkdir -p /data/uploads && chown -R node:node /data
USER node
EXPOSE 8080
# Миграции применяются при старте контейнера
CMD ["sh", "-c", "npx prisma migrate deploy && node apps/api/dist/server.js"]
