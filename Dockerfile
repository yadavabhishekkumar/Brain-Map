# UPSC Brain Map — one web service: Express API + built React frontend,
# plus headless Chromium (Playwright) for the e-paper downloader.
FROM node:20-bookworm-slim

# Skip Playwright's default all-browsers download during `npm install`;
# only Chromium is installed (with its system deps) below.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

WORKDIR /app

# Install dependencies first so this layer is cached across builds.
COPY backend/package.json backend/package-lock.json ./backend/
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN cd backend && npm install --no-audit --no-fund
RUN cd frontend && npm install --no-audit --no-fund

# Copy the rest of the source.
COPY backend ./backend
COPY frontend ./frontend

# Install Chromium and its system dependencies (apt runs as root in Docker).
RUN cd backend && npx playwright install --with-deps chromium

# Build the React frontend into frontend/dist (served by Express).
RUN cd frontend && npm run build

WORKDIR /app/backend
ENV NODE_ENV=production

CMD ["node", "src/index.js"]
