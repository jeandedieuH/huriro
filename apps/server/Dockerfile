# One image, three roles (ADR-0018): `bun src/index.ts serve --role=…`.
# Non-root, read-only-rootfs compatible (compose sets tmpfs /tmp).

FROM oven/bun:1.4.5-slim AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY packages/domain/package.json packages/domain/
COPY packages/db/package.json packages/db/
COPY packages/test-utils/package.json packages/test-utils/
COPY apps/server/package.json apps/server/
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.4.5-slim
WORKDIR /app
ENV NODE_ENV=production BUN_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY packages ./packages
COPY apps/server ./apps/server
COPY package.json ./
# pg_dump/pg_restore for `huriro backup|restore` (§19.3) — matching major.
USER root
RUN apt-get update \
	&& apt-get install -y --no-install-recommends postgresql-client-18 || apt-get install -y --no-install-recommends postgresql-client \
	&& rm -rf /var/lib/apt/lists/*
USER bun
WORKDIR /app/apps/server
EXPOSE 3001 3005
ENTRYPOINT ["bun", "src/index.ts"]
CMD ["serve", "--role=all"]
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s \
	CMD ["bun", "src/index.ts", "health"]
