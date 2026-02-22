FROM node:22-slim

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

# Expose port
EXPOSE 3000

# Run migrations, seed, then start API + Worker
CMD ["sh", "-c", "node dist/database/migrate.js && node dist/database/seed.js && node dist/index.js & node dist/worker.js & wait"]
