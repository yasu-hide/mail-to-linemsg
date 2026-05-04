FROM node:20-bookworm-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV npm_config_node_gyp="/usr/local/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js"
WORKDIR /app
RUN apt-get update \
	&& apt-get install -y --no-install-recommends python3 make g++ \
	&& rm -rf /var/lib/apt/lists/* \
	&& npm install -g @pnpm/exe@11.0.4
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml /app/

FROM base AS deps
RUN pnpm install --frozen-lockfile --ignore-scripts \
	&& cd "$(find node_modules/.pnpm -path '*/node_modules/iconv' -type d -print -quit)" \
	&& node "$npm_config_node_gyp" rebuild

FROM deps AS test
COPY . /app
RUN pnpm test

FROM base AS prod-deps
RUN pnpm install --prod --frozen-lockfile --ignore-scripts \
	&& cd "$(find node_modules/.pnpm -path '*/node_modules/iconv' -type d -print -quit)" \
	&& node "$npm_config_node_gyp" rebuild

FROM base AS production
COPY --from=prod-deps /app/node_modules /app/node_modules
COPY . /app
EXPOSE 3000
CMD ["node", "index.js"]
