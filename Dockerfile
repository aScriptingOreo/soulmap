# Dockerfile
# Use the official Node.js image as the base image
FROM node:20

# Set the working directory inside the container
WORKDIR /app

# Copy package.json and bun.lockb files to the working directory
COPY package.json bun.lockb ./

# Install dependencies
RUN npm install -g bun && bun install

# Copy the rest of the application code to the working directory
COPY . .

# Expose the port the app runs on
EXPOSE 5173

# Command to run the application
CMD ["bun", "run", "dev"]