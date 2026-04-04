FROM oven/bun:1-debian AS base

# Install Claude Code CLI as root
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates git \
    && curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
    && apt-get install -y nodejs \
    && npm install -g @anthropic-ai/claude-code \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN useradd -m -s /bin/bash claude

# Set up working directory
WORKDIR /app/eclaw-channel

# Copy plugin files
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile 2>/dev/null || bun install

COPY server.ts ./
COPY .claude-plugin/ ./.claude-plugin/
COPY .mcp.json ./

# Fix permissions
RUN chown -R claude:claude /app

# Expose webhook port
EXPOSE 18800

# Switch to non-root user
USER claude
ENV HOME=/home/claude

# Start Claude Code with the EClaw channel
CMD ["claude", "--dangerously-load-development-channels", "server:eclaw-channel", "-p", "You are an AI assistant connected to EClaw chat. Reply to all incoming messages using the eclaw_reply tool."]
