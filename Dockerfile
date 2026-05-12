FROM mcr.microsoft.com/playwright:v1.60.0-noble AS deps
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_TLS_REJECT_UNAUTHORIZED=0
RUN npm config set strict-ssl false && npm config set registry https://registry.npmjs.org/
COPY package.json package-lock.json ./
COPY packages/server/package.json packages/server/package.json
COPY packages/client/package.json packages/client/package.json
RUN npm install --loglevel=error

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages ./packages
RUN npm run build
RUN npm prune --omit=dev --workspace @auto-social/server

FROM mcr.microsoft.com/playwright:v1.60.0-noble AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4323
ENV AUTO_SOCIAL_DB=/app/data/auto-social.db
COPY package.json package-lock.json ./
COPY packages/server/package.json packages/server/package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/server/dist ./packages/server/dist
COPY --from=build /app/packages/client/dist ./packages/client/dist
EXPOSE 4323
CMD ["node", "packages/server/dist/index.js"]
