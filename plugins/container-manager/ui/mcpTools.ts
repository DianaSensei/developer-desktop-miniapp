// MCP tool catalogue for this plugin — bundled with it, not with the
// platform. Registered once (mcp_register_tools) when this plugin's own
// mcpBridge.ts mounts its `mcp:call` listener, so devtool-mcp-server.rs's
// dynamic `list_tools()` (no compiled-in tool list of its own — see that
// file's own comment) can advertise these to an MCP client without knowing
// this plugin exists at compile time. Kept in sync BY HAND with the
// `container_*` handlers in ./mcpBridge.ts — one JSON-Schema entry per tool
// name that file's `buildHandlers()` answers.
export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const CONTAINER_MCP_TOOLS: McpToolDef[] = [
  {
            "name": "container_list_connections",
            "description": "List every saved container-runtime connection profile (id, name, socketPath — a Unix socket or Windows named pipe path for a Docker-compatible daemon: Docker Desktop, colima, Rancher Desktop, OrbStack, Podman, …).",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "container_get_connection",
            "description": "Get one saved container connection profile by id.",
            "inputSchema": { "type": "object", "properties": { "connectionId": { "type": "string" } }, "required": ["connectionId"] }
        },
        {
            "name": "container_add_connection",
            "description": "Save a new container connection profile and return it (with its generated id). Both `name` and `socketPath` are required — there's no default socket path since it varies by runtime/OS.",
            "inputSchema": {
                "type": "object",
                "properties": { "name": { "type": "string" }, "socketPath": { "type": "string" } },
                "required": ["name", "socketPath"]
            }
        },
        {
            "name": "container_update_connection",
            "description": "Patch a saved container connection profile. `patch` is a partial object — only included fields change.",
            "inputSchema": {
                "type": "object",
                "properties": { "connectionId": { "type": "string" }, "patch": { "type": "object" } },
                "required": ["connectionId", "patch"]
            }
        },
        {
            "name": "container_delete_connection",
            "description": "Delete a saved container connection profile by id. The daemon itself is unaffected — only the local saved profile.",
            "inputSchema": { "type": "object", "properties": { "connectionId": { "type": "string" } }, "required": ["connectionId"] }
        },
        {
            "name": "container_test_connection",
            "description": "Verify a saved connection can reach the daemon, without marking it as the connected one.",
            "inputSchema": { "type": "object", "properties": { "connectionId": { "type": "string" } }, "required": ["connectionId"] }
        },
        {
            "name": "container_connect",
            "description": "Test and mark a saved connection as the active one (same as pressing Connect in the Containers UI). Every container_list/inspect/start/stop/…/image_* tool operates on this active connection.",
            "inputSchema": { "type": "object", "properties": { "connectionId": { "type": "string" } }, "required": ["connectionId"] }
        },
        {
            "name": "container_disconnect",
            "description": "Clear the active container connection (same as pressing Disconnect).",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "container_connection_status",
            "description": "Get the currently selected/connected container connection id.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "container_list",
            "description": "List containers on the active connection. `all=false` (default) shows running containers only; `all=true` includes stopped ones too.",
            "inputSchema": { "type": "object", "properties": { "all": { "type": "boolean" } } }
        },
        {
            "name": "container_inspect",
            "description": "Get one container's curated details: image, status, health, command, entrypoint, restart policy, env, labels, mounts, ports, networks, and cgroup resource limits.",
            "inputSchema": { "type": "object", "properties": { "containerId": { "type": "string" } }, "required": ["containerId"] }
        },
        {
            "name": "container_start",
            "description": "Start a stopped container.",
            "inputSchema": { "type": "object", "properties": { "containerId": { "type": "string" } }, "required": ["containerId"] }
        },
        {
            "name": "container_stop",
            "description": "Stop a running container.",
            "inputSchema": { "type": "object", "properties": { "containerId": { "type": "string" } }, "required": ["containerId"] }
        },
        {
            "name": "container_restart",
            "description": "Restart a container.",
            "inputSchema": { "type": "object", "properties": { "containerId": { "type": "string" } }, "required": ["containerId"] }
        },
        {
            "name": "container_pause",
            "description": "Pause a running container's processes (SIGSTOP-equivalent, freezes without stopping).",
            "inputSchema": { "type": "object", "properties": { "containerId": { "type": "string" } }, "required": ["containerId"] }
        },
        {
            "name": "container_unpause",
            "description": "Resume a paused container.",
            "inputSchema": { "type": "object", "properties": { "containerId": { "type": "string" } }, "required": ["containerId"] }
        },
        {
            "name": "container_remove",
            "description": "Remove a container. `force=true` removes it even if running (same as `docker rm -f`).",
            "inputSchema": {
                "type": "object",
                "properties": { "containerId": { "type": "string" }, "force": { "type": "boolean" } },
                "required": ["containerId"]
            }
        },
        {
            "name": "container_logs",
            "description": "Get a container's recent log output. This collects whatever the daemon streams back within about 1.5s, not a live tail — call again for newer output. `tail` (default \"100\") is a line count or \"all\"; `since`/`until` are Unix seconds (0 = no bound); `timestamps` prefixes each line with when the daemon logged it.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "containerId": { "type": "string" },
                    "tail": { "type": "string" },
                    "since": { "type": "number" },
                    "until": { "type": "number" },
                    "timestamps": { "type": "boolean" }
                },
                "required": ["containerId"]
            }
        },
        {
            "name": "container_stats",
            "description": "Get one CPU/memory/network usage sample for a running container (not a live stream — call again for a fresh sample).",
            "inputSchema": { "type": "object", "properties": { "containerId": { "type": "string" } }, "required": ["containerId"] }
        },
        {
            "name": "container_list_images",
            "description": "List images on the active connection (id, repo tags, created, size).",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "container_image_details",
            "description": "Get one image's curated details: repo tags/digests, size, architecture/os, cmd, entrypoint, env, working dir, exposed ports, labels, layer count.",
            "inputSchema": { "type": "object", "properties": { "imageId": { "type": "string" } }, "required": ["imageId"] }
        },
        {
            "name": "container_remove_image",
            "description": "Remove an image. `force=true` removes it even if a stopped container still references it.",
            "inputSchema": {
                "type": "object",
                "properties": { "imageId": { "type": "string" }, "force": { "type": "boolean" } },
                "required": ["imageId"]
            }
        },
];
