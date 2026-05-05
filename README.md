# ACP IM Client

A middleware bridge that connects popular Instant Messaging (IM) platforms with the **Gemini CLI** acting as an Agent Client Protocol (ACP) server. This allows you to interact with your AI coding agent directly from Slack, Discord, Telegram, or MS Teams.

## Features

- **Multi-Platform Support**: Integrated with Slack, Discord, Telegram, and Microsoft Teams.
- **Real-time Streaming**: Supports streaming of assistant responses and internal **thought processes** (reasoning).
- **Interactive Tool Calls**: Handles interactive permissions (Allow Once, Always Allow, Reject) for tool executions (e.g., shell commands, file edits).
- **Interactive Shell Input**: Automatically detects when a bash command requires confirmation (e.g., `[Y/n]`) and allows you to respond directly from the chat.
- **Live Shell Output**: Forwards standard output and terminal logs from the agent directly to the chat.
- **Resilient Protocol**: Robust JSON-RPC 2.0 implementation with resilient stream parsing.
- **Smart Message Splitting**: Automatically handles platform-specific character limits (e.g., Discord's 2000-character limit).
- **Session Management**: Manage multiple conversation contexts via slash commands.

## Slash Commands

You can control your sessions directly from the chat using the `/session` command:

- **`/session new [path]`**: Starts a completely fresh conversation with a new ACP session ID. Optionally specify a directory `path` to use as the working directory for the session. (Default if no subcommand is provided).
- **`/session ls`**: Lists all active sessions created during the current process. The current active session for the channel is marked with a ✅.
- **`/session use <index>`**: Switches the current channel to the specified session index (e.g., `/session use 0`).
- **`/session status`**: Shows token usage, context size, and usage rate for the current session.

## Prerequisites

- **Node.js** (v20 or higher)
- **Gemini CLI** installed and available in your PATH (or specified via `GEMINI_PATH`).
- API Tokens for your chosen IM platform(s).

## Getting Started

### 1. Installation

```bash
git clone git@github.com:linjiang82/acp-im-client.git
cd acp-im-client
npm install
```

### 2. Configuration

Create a `.env` file in the root directory (use `.env.example` as a template):

```env
# IM Platform Tokens
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-... # Required for Socket Mode
DISCORD_TOKEN=...
TELEGRAM_TOKEN=...

# Gemini Configuration
GEMINI_PATH=gemini
GEMINI_CWD=/path/to/your/project
SHOW_THOUGHTS=true
LOG_LEVEL=info
```

### 3. Running the Client

```bash
# Build the project
npm run build

# Start the client
npm start
```

## How It Works

1. **Initialization**: The client spawns `gemini --acp` as a child process.
2. **Session Management**: Each IM channel/thread is mapped to a unique ACP session ID.
3. **Turn Loop**: 
   - You send a message in your IM app.
   - The client forwards it to the agent via the `session/prompt` method.
   - The agent's thoughts and messages are streamed back via `session/update` notifications.
   - If the agent needs permission to run a tool, the client asks you in the chat.
   - Once the turn is complete, the final response (and any tool outputs) are delivered to the chat.

## Development

- `npm test`: Run the test suite (Unit & Integration tests).
- `npm run lint`: Run ESLint.
- `npm run dev`: Start with `tsx watch` for development.

## License

MIT
