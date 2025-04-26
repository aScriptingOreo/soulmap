# Use the latest Bun image as base
FROM oven/bun:latest

# Set working directory
WORKDIR /app

# Copy package files first for better caching
COPY package.json bun.lockb* ./

# Install dependencies (including dev dependencies for Prisma)
RUN bun install

# Copy the rest of the application
COPY . .

# Generate Prisma client
RUN bunx prisma generate

# Set environment variables
ENV NODE_ENV=production
ENV SERVER_PORT=3000

# Expose the port the app runs on
EXPOSE 3000

# Add healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun run -e "fetch('http://localhost:3000/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Command to run the app in development mode
# Using the dev script which includes prisma generate and hot reloading
CMD ["bun", "run", "dev"]
