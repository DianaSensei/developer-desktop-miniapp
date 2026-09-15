// MCP tool catalogue for this plugin — bundled with it, not with the
// platform. Registered once (mcp_register_tools) when this plugin's own
// mcpBridge.ts mounts its `mcp:call` listener, so devtool-mcp-server.rs's
// dynamic `list_tools()` (no compiled-in tool list of its own — see that
// file's own comment) can advertise these to an MCP client without knowing
// this plugin exists at compile time. Kept in sync BY HAND with the
// `redis_*` handlers in ./mcpBridge.ts — one JSON-Schema entry per tool
// name that file's `buildHandlers()` answers.
export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const REDIS_MCP_TOOLS: McpToolDef[] = [
  {
            "name": "redis_list_connections",
            "description": "List every saved Redis connection profile (id, name, host, port, username, password, useTls). Values are returned as stored, unmasked, same as the app's own connection form.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "redis_get_connection",
            "description": "Get one saved Redis connection profile by id.",
            "inputSchema": { "type": "object", "properties": { "connectionId": { "type": "string" } }, "required": ["connectionId"] }
        },
        {
            "name": "redis_add_connection",
            "description": "Save a new Redis connection profile and return it (with its generated id). `name`/`host` required; `port` defaults to 6379, `useTls` to false.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "name": { "type": "string" },
                    "host": { "type": "string" },
                    "port": { "type": "number" },
                    "username": { "type": "string" },
                    "password": { "type": "string" },
                    "useTls": { "type": "boolean" }
                },
                "required": ["name"]
            }
        },
        {
            "name": "redis_update_connection",
            "description": "Patch a saved Redis connection profile. `patch` is a partial object — only included fields change.",
            "inputSchema": {
                "type": "object",
                "properties": { "connectionId": { "type": "string" }, "patch": { "type": "object" } },
                "required": ["connectionId", "patch"]
            }
        },
        {
            "name": "redis_delete_connection",
            "description": "Delete a saved Redis connection profile by id. The server itself is unaffected — only the local saved profile.",
            "inputSchema": { "type": "object", "properties": { "connectionId": { "type": "string" } }, "required": ["connectionId"] }
        },
        {
            "name": "redis_test_connection",
            "description": "Verify a saved connection is reachable, without marking it as the connected one.",
            "inputSchema": { "type": "object", "properties": { "connectionId": { "type": "string" } }, "required": ["connectionId"] }
        },
        {
            "name": "redis_connect",
            "description": "Test and mark a saved connection as the active one in the Redis Client UI (same as pressing Connect). Optionally also switch the active logical db (0-15) via `db`.",
            "inputSchema": {
                "type": "object",
                "properties": { "connectionId": { "type": "string" }, "db": { "type": "number" } },
                "required": ["connectionId"]
            }
        },
        {
            "name": "redis_disconnect",
            "description": "Clear the active Redis connection (same as pressing Disconnect).",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "redis_connection_status",
            "description": "Get the currently selected/connected Redis connection id and active db.",
            "inputSchema": { "type": "object", "properties": {} }
        },
];
