FROM node:20-slim

WORKDIR /app

# Install dependencies for Gemini CLI (if needed, or mount it)
# For now, we assume the user might mount the binary or it's pre-installed.
# We also need some base utilities.
RUN apt-get update && apt-get install -y curl ca-certificates && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# Default environment variables
ENV NODE_ENV=production
ENV GEMINI_PATH=gemini

CMD ["npm", "start"]
