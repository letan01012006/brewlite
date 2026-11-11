FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY . .
# Generating/types/building needs no connection to the application database.
RUN DATABASE_URL=postgresql://build:build@localhost/build npx prisma generate \
    && npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/src/generated/prisma ./src/generated/prisma
COPY --from=build /app/prisma.config.ts /app/package.json ./
COPY --chmod=755 docker-entrypoint.sh ./docker-entrypoint.sh
USER node
EXPOSE 4000
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
