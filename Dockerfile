FROM node:24-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN npm install --global pnpm@11.16.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
# Client generation reads the config but does not connect to this placeholder URL.
RUN DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build pnpm db:generate
RUN pnpm build
ENV NODE_ENV=production
CMD ["sh", "-c", "exec pnpm \"${APP_PROCESS:-start}\""]
