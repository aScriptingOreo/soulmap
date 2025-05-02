FROM node:18-alpine

# Create app directory
WORKDIR /app

# Copy package.json and package-lock.json first for better caching
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy application code
COPY . .

# Expose the port for Traefik (no need to publish it in docker-compose)
EXPOSE 3000

# Run the application
CMD ["npm", "start"]
