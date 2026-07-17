# VoxAgent server — image production
FROM node:22-slim

# Không tải browser của Playwright vào image server (server không cần).
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV NODE_ENV=production

# Bật pnpm qua corepack (đã kèm trong Node 22).
RUN corepack enable

WORKDIR /app

# Copy manifest trước để tận dụng cache layer khi cài deps.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages ./packages
COPY apps ./apps
COPY tsconfig.base.json ./

# Cài toàn workspace + build các package ra dist.
RUN pnpm install --frozen-lockfile && pnpm -r build

# Chạy dưới user không phải root (giảm rủi ro).
USER node

EXPOSE 8787
# Secret truyền qua biến môi trường lúc `docker run -e ...`, KHÔNG nướng vào image.
CMD ["node", "--import", "tsx", "apps/server/src/index.ts"]
