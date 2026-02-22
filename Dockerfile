FROM ghcr.io/puppeteer/puppeteer:24.1.0

# Set environment variables for Puppeteer
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# Switch to root for full permissions during build
USER root

# Set working directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Remove devDependencies after build
RUN npm prune --omit=dev

# Fix ownership for pptruser
RUN chown -R pptruser:pptruser /app

# Switch back to pptruser for security
USER pptruser

# Expose port
EXPOSE 3000

# Run migrations, seed, then start API + Worker
CMD ["sh", "-c", "node dist/database/migrate.js && node dist/database/seed.js && node dist/index.js & node dist/worker.js & wait"]
