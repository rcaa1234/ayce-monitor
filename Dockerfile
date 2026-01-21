FROM ghcr.io/puppeteer/puppeteer:24.1.0

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (as root before switching user)
USER root
RUN npm ci --omit=dev

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Switch back to pptruser for security
USER pptruser

# Expose port
EXPOSE 3000

# Start server
CMD ["node", "dist/server.js"]
