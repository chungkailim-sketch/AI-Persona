FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Placeholder so `prisma generate` can load its config; no database is contacted at build time.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npm run build
ENV NODE_ENV=production
EXPOSE 3000
# Railway overrides this per service (web: npm run start, worker: npx tsx worker.ts).
CMD ["npm", "run", "start"]
