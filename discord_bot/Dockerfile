FROM node:16-alpine

WORKDIR /app

# Install required dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++ sqlite

COPY package*.json ./

# Install dependencies including dev dependencies
RUN npm install

# Copy source files
COPY . .

# Create data directory for SQLite database
RUN mkdir -p /app/data

# Volume for database persistence
VOLUME /app/data

# Start command that respects NODE_ENV
CMD [ "node", "dev" ]
