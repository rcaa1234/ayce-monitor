FROM ghcr.io/puppeteer/puppeteer:24.1.0

# Set environment variables for Puppeteer
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (as root before switching user)
USER root

# Copy source code first
COPY . .

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Build TypeScript
RUN npm run build

# Remove devDependencies after build
RUN npm prune --omit=dev

# Switch back to pptruser for security
USER pptruser

# Expose port
EXPOSE 3000

# Start server
CMD ["node", "dist/server.js"]
