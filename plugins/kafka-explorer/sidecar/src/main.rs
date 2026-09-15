// Plugin dịch vụ (tier B) cho Kafka Explorer — port từ
// developer-desktop-utils's src-tauri/src/kafka.rs, giữ nguyên toàn bộ logic
// rskafka + wire-protocol thô (metadata/offsets/groups/configs — rskafka
// không expose các API này) và HÌNH DẠNG dữ liệu JSON (camelCase). Khác với
// bản Tier A đúng những chỗ là hệ quả của việc chạy như tiến trình riêng —
// xem redis-client/sidecar/src/main.rs's file-level comment cho giải thích
// đầy đủ về hai điểm đó (không có AppHandle -> DEVTOOL_SERVICE_DATA_DIR; có
// thể nhiều lời gọi chồng lên nhau -> spawn một task async mỗi dòng, một
// task riêng sở hữu stdout).
//
// Realtime consumer (`consume-start`/`consume-stop`) theo ĐÚNG idiom
// pubsub-subscribe/unsubscribe của devtool-svc-redis: `consume-start` là
// method STREAM (không đi qua `handle()` một-lần) — sự kiện đầu tiên mang
// `{"type":"started","consumerId":...}` (id NỘI BỘ, khác `request.id`),
// sau đó `{"type":"message",...}` cho mỗi record, cho tới khi bị
// `consume-stop` (method khác, mang đúng `consumerId`) dừng tay, hoặc tự
// dừng khi ghi stdout bắt đầu lỗi (host đã đóng ống). Lỗi trong lúc chạy
// (topic biến mất, mất kết nối) gói vào `{"type":"error",...}` — KHÔNG dùng
// `Response::err` — cùng lý do redis's `send_pubsub_error` giải thích: một
// stream mang `error` ở tầng khung tin bị `service_host.rs::dispatch()` coi
// là "kết thúc" và bỏ qua, không bao giờ tới được `onMessage` phía client.

use rskafka::client::{ClientBuilder, partition::{Compression, OffsetAt, UnknownTopicHandling}};
use rskafka::record::Record;
use serde::{Deserialize, Serialize};
use chrono::Utc;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use base64::Engine;
use uuid::Uuid;

pub const SERVICE_PROTOCOL: u32 = 1;

// ── Khung tin nhắn (giống mọi sidecar khác — xem devtool-svc-echo) ──────────

#[derive(Deserialize)]
struct Request {
    protocol: u32,
    id: String,
    #[serde(default)]
    method: String,
    #[serde(default)]
    params: serde_json::Value,
}

fn is_false(b: &bool) -> bool {
    !*b
}

#[derive(Serialize)]
struct Response {
    protocol: u32,
    id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(default, skip_serializing_if = "is_false")]
    stream: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    done: bool,
}

impl Response {
    fn once(id: String, result: serde_json::Value) -> Self {
        Self { protocol: SERVICE_PROTOCOL, id, result: Some(result), error: None, stream: false, done: false }
    }
    fn ok(id: String) -> Self {
        Self::once(id, serde_json::Value::Null)
    }
    fn err(id: String, message: impl Into<String>) -> Self {
        Self { protocol: SERVICE_PROTOCOL, id, result: None, error: Some(message.into()), stream: false, done: false }
    }
    fn event(id: String, result: serde_json::Value) -> Self {
        Self { protocol: SERVICE_PROTOCOL, id, result: Some(result), error: None, stream: true, done: false }
    }
}

// ── Data types — giữ nguyên hình dạng camelCase của kafka.rs ────────────────

// ── Data types ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrokerConfig {
    pub id: String,
    pub name: String,
    pub bootstrap_servers: String,
    pub sasl_mechanism: Option<String>,
    pub sasl_username: Option<String>,
    pub sasl_password: Option<String>,
    pub ssl_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopicSummary {
    pub name: String,
    pub partition_count: i32,
    pub replication_factor: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PartitionInfo {
    pub id: i32,
    pub leader: i32,
    pub earliest_offset: i64,
    pub latest_offset: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupLag {
    pub group_id: String,
    pub partition: i32,
    pub committed_offset: i64,
    pub lag: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopicDetails {
    pub name: String,
    pub partitions: Vec<PartitionInfo>,
    pub replication_factor: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopicConfig {
    pub name: String,
    pub value: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupSummary {
    pub group_id: String,
    pub state: String,
    pub protocol_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Assignment {
    pub topic: String,
    pub partition: i32,
    pub committed_offset: i64,
    pub lag: i64,
    // The member currently assigned this partition, if the group is active.
    // None for committed offsets with no live owner (e.g. Empty groups).
    pub client_id: Option<String>,
    pub client_host: Option<String>,
    pub member_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupMember {
    pub member_id: String,
    pub client_id: String,
    pub client_host: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupDetails {
    pub group_id: String,
    pub state: String,
    pub member_count: i32,
    pub members: Vec<GroupMember>,
    pub assignments: Vec<Assignment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProduceResult {
    pub partition: i32,
    pub offset: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KafkaMessage {
    pub offset: i64,
    pub partition: i32,
    pub timestamp: String,
    pub key: Option<String>,
    pub value: Option<String>,
    pub headers: std::collections::BTreeMap<String, String>,
}

/// A record delivered by the realtime (anonymous) consumer. Carries the value
/// both as UTF-8 text (when decodable) and base64 of the raw bytes, so the UI can
/// render it as plain string, prettified JSON, or a hex dump.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KafkaConsumedMessage {
    pub partition: i32,
    pub offset: i64,
    pub timestamp: String,
    pub key: Option<String>,
    /// UTF-8 value when decodable, else null.
    pub value: Option<String>,
    /// Raw value bytes, base64-encoded (None when the record had no value).
    pub value_b64: Option<String>,
    pub headers: std::collections::BTreeMap<String, String>,
}


#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchRecord {
    pub key: Option<String>,
    pub value: String,
    #[serde(default)]
    pub headers: HashMap<String, String>,
}

// ── Config persistence ───────────────────────────────────────────────────────
//
// Thư mục RIÊNG của sidecar này (`DEVTOOL_SERVICE_DATA_DIR` —
// `<app_data>/service-data/devtool-svc-kafka/`) — xem redis-client/sidecar's
// comment tương ứng cho lý do cách ly bằng thư mục, không phải bằng tên file.

fn app_data_dir() -> Result<PathBuf, String> {
    std::env::var("DEVTOOL_SERVICE_DATA_DIR")
        .map(PathBuf::from)
        .map_err(|_| "DEVTOOL_SERVICE_DATA_DIR không được set — sidecar phải chạy qua service_host.rs".to_string())
}

fn configs_path() -> Result<PathBuf, String> {
    Ok(app_data_dir()?.join("brokers.json"))
}

fn load_configs() -> Vec<BrokerConfig> {
    let Ok(path) = configs_path() else { return Vec::new(); };
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_configs(configs: &[BrokerConfig]) -> Result<(), String> {
    let path = configs_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(configs).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

fn find_config(config_id: &str) -> Result<BrokerConfig, String> {
    load_configs()
        .into_iter()
        .find(|c| c.id == config_id)
        .ok_or_else(|| format!("Broker config '{}' not found", config_id))
}

// ── rskafka client ────────────────────────────────────────────────────────────

fn parse_brokers(bootstrap_servers: &str) -> Vec<String> {
    bootstrap_servers
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

/// Validate create-topic inputs before any broker call, so obviously-invalid
/// requests (empty name, 0/negative/absurd partition count, bad RF) are
/// rejected client-side with a clear message.
fn validate_create_topic(name: &str, num_partitions: i32, replication_factor: i16) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("Topic name is required".into());
    }
    if !(1..=10_000).contains(&num_partitions) {
        return Err(format!("Partitions must be between 1 and 10000 (got {num_partitions})"));
    }
    if replication_factor < 1 {
        return Err(format!("Replication factor must be at least 1 (got {replication_factor})"));
    }
    Ok(())
}

async fn make_client(config: &BrokerConfig) -> Result<rskafka::client::Client, String> {
    let brokers = parse_brokers(&config.bootstrap_servers);
    if brokers.is_empty() {
        return Err("No broker addresses specified".to_string());
    }
    ClientBuilder::new(brokers)
        .build()
        .await
        .map_err(|e| e.to_string())
}

// ── Kafka wire protocol ───────────────────────────────────────────────────────
// Used for operations not covered by rskafka: metadata, offsets, consumer groups, create topic.

async fn connect_broker(addr: &str) -> Result<TcpStream, String> {
    tokio::time::timeout(
        std::time::Duration::from_secs(5),
        TcpStream::connect(addr),
    )
    .await
    .map_err(|_| format!("Timeout connecting to {}", addr))?
    .map_err(|e| format!("Failed to connect to {}: {}", addr, e))
}

/// Opens a TcpStream to the first address in bootstrap_servers that speaks Kafka protocol.
/// Probes each address with a MetadataRequest so that non-Kafka ports (e.g. ZooKeeper)
/// are skipped automatically instead of returning "early eof".
async fn open_kafka_stream(config: &BrokerConfig) -> Result<TcpStream, String> {
    let brokers = parse_brokers(&config.bootstrap_servers);
    if brokers.is_empty() {
        return Err("No broker addresses specified".to_string());
    }
    let mut errors: Vec<String> = Vec::new();
    for addr in &brokers {
        match connect_broker(addr).await {
            Err(e) => { errors.push(format!("{addr}: {e}")); }
            Ok(mut probe) => {
                match wire_metadata(&mut probe, &[]).await {
                    Ok(_) => {
                        // Confirmed Kafka. Reuse this very connection for the command:
                        // send_request read the probe's full framed response, so the
                        // stream is at a clean message boundary. Reusing it (instead of
                        // opening a second connection) halves the TCP connections every
                        // read operation makes against the broker.
                        return Ok(probe);
                    }
                    Err(e) => {
                        errors.push(format!("{addr}: {e} (not a Kafka broker?)"));
                    }
                }
            }
        }
    }
    Err(format!(
        "Could not reach any Kafka broker. Tried: {}. \
         Make sure bootstrap servers contains only Kafka broker ports, not ZooKeeper.",
        errors.join("; ")
    ))
}

async fn send_request(
    stream: &mut TcpStream,
    api_key: i16,
    api_version: i16,
    correlation_id: i32,
    body: &[u8],
) -> Result<Vec<u8>, String> {
    let client_id = b"devtool";
    let mut msg = Vec::new();
    msg.extend_from_slice(&api_key.to_be_bytes());
    msg.extend_from_slice(&api_version.to_be_bytes());
    msg.extend_from_slice(&correlation_id.to_be_bytes());
    msg.extend_from_slice(&(client_id.len() as i16).to_be_bytes());
    msg.extend_from_slice(client_id);
    msg.extend_from_slice(body);

    const WRITE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);
    const READ_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

    // Wrap writes in a timeout too — a half-open / wedged socket would otherwise
    // let write_all block indefinitely and hang the command.
    let size = msg.len() as i32;
    tokio::time::timeout(WRITE_TIMEOUT, stream.write_all(&size.to_be_bytes()))
        .await
        .map_err(|_| "Kafka write timed out (30 s)".to_string())?
        .map_err(|e| e.to_string())?;
    tokio::time::timeout(WRITE_TIMEOUT, stream.write_all(&msg))
        .await
        .map_err(|_| "Kafka write timed out (30 s)".to_string())?
        .map_err(|e| e.to_string())?;

    let mut size_buf = [0u8; 4];
    tokio::time::timeout(READ_TIMEOUT, stream.read_exact(&mut size_buf))
        .await
        .map_err(|_| "Kafka read timed out (30 s)".to_string())?
        .map_err(|e| e.to_string())?;
    let rlen = i32::from_be_bytes(size_buf);
    // The length comes straight off the socket. Validate it before allocating:
    // a non-Kafka server (e.g. an HTTP/TLS port reached by a typo in
    // bootstrap_servers) or a malicious peer could otherwise send a huge or
    // negative size and trigger a multi-GB allocation → OOM crash. A response
    // must also be at least 4 bytes to contain the correlation id we skip below.
    const MAX_RESPONSE_BYTES: i32 = 64 * 1024 * 1024; // 64 MB — ample for metadata/offsets/groups/configs
    if rlen < 4 || rlen > MAX_RESPONSE_BYTES {
        return Err(format!(
            "Invalid Kafka response size ({rlen} bytes) — is this a Kafka broker port?"
        ));
    }
    let mut resp = vec![0u8; rlen as usize];
    tokio::time::timeout(READ_TIMEOUT, stream.read_exact(&mut resp))
        .await
        .map_err(|_| "Kafka read timed out (30 s)".to_string())?
        .map_err(|e| e.to_string())?;
    // skip correlation_id (4 bytes)
    Ok(resp[4..].to_vec())
}

struct Dec<'a> {
    data: &'a [u8],
    pos: usize,
}

impl<'a> Dec<'a> {
    fn new(data: &'a [u8]) -> Self {
        Self { data, pos: 0 }
    }

    fn i16(&mut self) -> Result<i16, String> {
        self.ensure(2)?;
        let v = i16::from_be_bytes(self.data[self.pos..self.pos + 2].try_into().unwrap());
        self.pos += 2;
        Ok(v)
    }

    fn i32(&mut self) -> Result<i32, String> {
        self.ensure(4)?;
        let v = i32::from_be_bytes(self.data[self.pos..self.pos + 4].try_into().unwrap());
        self.pos += 4;
        Ok(v)
    }

    fn i64(&mut self) -> Result<i64, String> {
        self.ensure(8)?;
        let v = i64::from_be_bytes(self.data[self.pos..self.pos + 8].try_into().unwrap());
        self.pos += 8;
        Ok(v)
    }

    fn str(&mut self) -> Result<String, String> {
        let len = self.i16()?;
        if len < 0 {
            return Ok(String::new());
        }
        let len = len as usize;
        self.ensure(len)?;
        let s = String::from_utf8_lossy(&self.data[self.pos..self.pos + len]).to_string();
        self.pos += len;
        Ok(s)
    }

    fn bytes(&mut self) -> Result<Vec<u8>, String> {
        let len = self.i32()?;
        if len < 0 {
            return Ok(vec![]);
        }
        let len = len as usize;
        self.ensure(len)?;
        let b = self.data[self.pos..self.pos + len].to_vec();
        self.pos += len;
        Ok(b)
    }

    fn array<T, F: FnMut(&mut Dec) -> Result<T, String>>(&mut self, mut f: F) -> Result<Vec<T>, String> {
        let count = self.i32()?;
        if count < 0 {
            return Ok(vec![]);
        }
        // Reject impossible counts before iterating. Every array element occupies
        // at least one byte on the wire, so a count larger than the bytes left in
        // the buffer is malformed — bail instead of spinning the loop (and
        // pre-sizing a huge Vec) on a bogus/hostile length.
        let count = count as usize;
        if count > self.data.len() - self.pos {
            return Err(format!(
                "Decode array count ({}) exceeds remaining buffer ({} bytes)",
                count,
                self.data.len() - self.pos
            ));
        }
        let mut out = Vec::with_capacity(count);
        for _ in 0..count {
            out.push(f(self)?);
        }
        Ok(out)
    }

    fn nullable_str(&mut self) -> Result<Option<String>, String> {
        let len = self.i16()?;
        if len < 0 { return Ok(None); }
        let len = len as usize;
        self.ensure(len)?;
        let s = String::from_utf8_lossy(&self.data[self.pos..self.pos + len]).to_string();
        self.pos += len;
        Ok(Some(s))
    }

    fn bool_val(&mut self) -> Result<bool, String> {
        self.ensure(1)?;
        let v = self.data[self.pos] != 0;
        self.pos += 1;
        Ok(v)
    }

    fn skip(&mut self, n: usize) -> Result<(), String> {
        self.ensure(n)?;
        self.pos += n;
        Ok(())
    }

    fn ensure(&self, n: usize) -> Result<(), String> {
        if self.pos + n > self.data.len() {
            Err(format!("Decode buffer too short (need {} at pos {})", n, self.pos))
        } else {
            Ok(())
        }
    }
}

fn enc_str(buf: &mut Vec<u8>, s: &str) {
    buf.extend_from_slice(&(s.len() as i16).to_be_bytes());
    buf.extend_from_slice(s.as_bytes());
}

fn enc_i32(buf: &mut Vec<u8>, v: i32) {
    buf.extend_from_slice(&v.to_be_bytes());
}

fn enc_i64(buf: &mut Vec<u8>, v: i64) {
    buf.extend_from_slice(&v.to_be_bytes());
}

// MetadataRequest v0 (API 3) — returns topics with partition/replica info
async fn wire_metadata(
    stream: &mut TcpStream,
    topics: &[&str],
) -> Result<Vec<TopicSummary>, String> {
    let mut body = Vec::new();
    enc_i32(&mut body, topics.len() as i32);
    for t in topics {
        enc_str(&mut body, t);
    }
    let resp = send_request(stream, 3, 0, 1, &body).await?;
    let mut d = Dec::new(&resp);
    // skip brokers array
    let broker_count = d.i32()?;
    for _ in 0..broker_count {
        d.i32()?; // node_id
        d.str()?; // host
        d.i32()?; // port
    }
    // topic metadata
    d.array(|d| {
        let _err = d.i16()?;
        let name = d.str()?;
        let partitions = d.array(|d| {
            d.i16()?; // partition error
            let _pid = d.i32()?;
            let _leader = d.i32()?;
            let replicas = d.array(|d| d.i32())?;
            d.array(|d| d.i32())?; // isr
            Ok(replicas.len() as i32)
        })?;
        let partition_count = partitions.len() as i32;
        let replication_factor = partitions.first().copied().unwrap_or(0);
        Ok(TopicSummary { name, partition_count, replication_factor })
    })
}

// ListOffsetsRequest v0 (API 2) — earliest (-2) or latest (-1)
async fn wire_list_offsets(
    stream: &mut TcpStream,
    topic: &str,
    partition_ids: &[i32],
    timestamp: i64, // -1 = latest, -2 = earliest
) -> Result<Vec<(i32, i64)>, String> {
    let mut body = Vec::new();
    enc_i32(&mut body, -1); // replica_id
    enc_i32(&mut body, 1);  // topic count
    enc_str(&mut body, topic);
    enc_i32(&mut body, partition_ids.len() as i32);
    for &pid in partition_ids {
        enc_i32(&mut body, pid);
        enc_i64(&mut body, timestamp);
        enc_i32(&mut body, 1); // max_num_offsets (v0 only)
    }
    let resp = send_request(stream, 2, 0, 2, &body).await?;
    let mut d = Dec::new(&resp);
    let mut result = Vec::new();
    d.array(|d| {
        let _topic = d.str()?;
        d.array(|d| {
            let pid = d.i32()?;
            let _err = d.i16()?;
            let offsets = d.array(|d| d.i64())?;
            let offset = offsets.into_iter().next().unwrap_or(-1);
            result.push((pid, offset));
            Ok(())
        })
    })?;
    Ok(result)
}

// ListGroupsRequest v0 (API 16)
async fn wire_list_groups(stream: &mut TcpStream) -> Result<Vec<GroupSummary>, String> {
    let resp = send_request(stream, 16, 0, 3, &[]).await?;
    let mut d = Dec::new(&resp);
    let _err = d.i16()?;
    d.array(|d| {
        let group_id = d.str()?;
        let protocol_type = d.str()?;
        Ok(GroupSummary { group_id, state: String::new(), protocol_type })
    })
}

// A group member plus the topic/partitions it currently owns, decoded from
// the member_assignment blob in the DescribeGroups response.
struct MemberWithAssignment {
    member: GroupMember,
    owned: Vec<(String, i32)>,
}

// Decode the consumer-protocol member_assignment blob:
//   Version: int16
//   Assignment: [ Topic: string, Partitions: [int32] ]
//   UserData: bytes
// Returns the (topic, partition) pairs owned by the member. Tolerant of
// non-consumer protocols / malformed data — returns what it could parse.
fn parse_member_assignment(bytes: &[u8]) -> Vec<(String, i32)> {
    if bytes.is_empty() {
        return Vec::new();
    }
    let mut d = Dec::new(bytes);
    if d.i16().is_err() {
        return Vec::new();
    }
    let mut owned = Vec::new();
    let topics = d.array(|d| {
        let topic = d.str()?;
        let parts = d.array(|d| d.i32())?;
        Ok((topic, parts))
    });
    if let Ok(topics) = topics {
        for (topic, parts) in topics {
            for p in parts {
                owned.push((topic.clone(), p));
            }
        }
    }
    owned
}

// DescribeGroupsRequest v0 (API 15)
async fn wire_describe_groups(
    stream: &mut TcpStream,
    group_ids: &[&str],
) -> Result<Vec<(String, String, Vec<MemberWithAssignment>)>, String> {
    // returns (group_id, state, members)
    let mut body = Vec::new();
    enc_i32(&mut body, group_ids.len() as i32);
    for gid in group_ids {
        enc_str(&mut body, gid);
    }
    let resp = send_request(stream, 15, 0, 4, &body).await?;
    let mut d = Dec::new(&resp);
    d.array(|d| {
        let _err = d.i16()?;
        let group_id = d.str()?;
        let state = d.str()?;
        let _protocol_type = d.str()?;
        let _protocol = d.str()?;
        let members = d.array(|d| {
            let member_id = d.str()?;
            let client_id = d.str()?;
            let client_host = d.str()?;
            d.bytes()?; // member_metadata
            let assignment = d.bytes()?; // member_assignment
            let owned = parse_member_assignment(&assignment);
            Ok(MemberWithAssignment {
                member: GroupMember { member_id, client_id, client_host },
                owned,
            })
        })?;
        Ok((group_id, state, members))
    })
}

// OffsetFetchRequest v2 (API 9) — committed offsets for a group.
//
// `topics = Some(&[...])` fetches the listed topic/partitions; `topics = None`
// uses v2's null-topics form to return *all* committed offsets for the group in
// a single request — no need to enumerate cluster topics first. v2 adds a
// trailing top-level error_code (consumed and ignored below).
async fn wire_offset_fetch(
    stream: &mut TcpStream,
    group_id: &str,
    topics: Option<&[(&str, Vec<i32>)]>,
) -> Result<Vec<(String, i32, i64)>, String> {
    // returns (topic, partition, committed_offset)
    let mut body = Vec::new();
    enc_str(&mut body, group_id);
    match topics {
        None => enc_i32(&mut body, -1), // null array = all topics for the group
        Some(topics) => {
            enc_i32(&mut body, topics.len() as i32);
            for (topic, parts) in topics {
                enc_str(&mut body, topic);
                enc_i32(&mut body, parts.len() as i32);
                for &p in parts {
                    enc_i32(&mut body, p);
                }
            }
        }
    }
    let resp = send_request(stream, 9, 2, 5, &body).await?;
    let mut d = Dec::new(&resp);
    let mut result = Vec::new();
    d.array(|d| {
        let topic = d.str()?;
        d.array(|d| {
            let partition = d.i32()?;
            let offset = d.i64()?;
            d.str()?; // metadata
            let _err = d.i16()?;
            if offset >= 0 {
                result.push((topic.clone(), partition, offset));
            }
            Ok(())
        })
    })?;
    let _top_level_err = d.i16(); // v2 trailing error_code; ignore (may be absent on error)
    Ok(result)
}

// DescribeConfigs v0 (API 32) — topic config entries (retention.ms, cleanup.policy, etc.)
async fn wire_describe_configs(
    stream: &mut TcpStream,
    topic: &str,
) -> Result<Vec<TopicConfig>, String> {
    let mut body = Vec::new();
    enc_i32(&mut body, 1);     // 1 resource
    body.push(2u8);            // resource_type = TOPIC
    enc_str(&mut body, topic);
    enc_i32(&mut body, 0);     // config_names: empty array = all configs

    let resp = send_request(stream, 32, 0, 6, &body).await?;
    let mut d = Dec::new(&resp);

    d.i32()?; // throttle_time_ms

    let mut result = Vec::new();
    d.array(|d| {
        let _err = d.i16()?;
        let _msg = d.nullable_str()?;
        d.skip(1)?;      // resource_type (i8)
        let _rname = d.str()?;
        d.array(|d| {
            let name = d.str()?;
            let value = d.nullable_str()?;
            d.bool_val()?; // read_only
            d.bool_val()?; // is_default
            d.bool_val()?; // is_sensitive
            result.push(TopicConfig { name, value });
            Ok(())
        })?;
        Ok(())
    })?;

    result.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(result)
}

// ── Realtime consumer registry — Notify-based, same idiom as
// devtool-svc-redis's PubSubRegistry (see that file for the full rationale:
// sidecar-local registry keyed by an INTERNAL consumerId, separate from
// service_host.rs's own per-request-id Waiters). ─────────────────────────

#[derive(Default)]
struct ConsumerRegistry {
    inner: Mutex<HashMap<String, Arc<tokio::sync::Notify>>>,
}

static REGISTRY: OnceLock<ConsumerRegistry> = OnceLock::new();

fn registry() -> &'static ConsumerRegistry {
    REGISTRY.get_or_init(ConsumerRegistry::default)
}

// ── Params helpers ───────────────────────────────────────────────────────────

fn param<T: serde::de::DeserializeOwned>(params: &serde_json::Value, field: &str) -> Result<T, String> {
    params
        .get(field)
        .cloned()
        .ok_or_else(|| format!("thiếu tham số \"{field}\""))
        .and_then(|v| serde_json::from_value(v).map_err(|e| format!("tham số \"{field}\" sai kiểu: {e}")))
}

fn opt_param<T: serde::de::DeserializeOwned>(params: &serde_json::Value, field: &str) -> Option<T> {
    params.get(field).cloned().and_then(|v| serde_json::from_value(v).ok())
}

// ── Method dispatch ───────────────────────────────────────────────────────────

async fn handle(method: &str, params: serde_json::Value) -> Result<serde_json::Value, String> {
    match method {
        "list-configs" => Ok(serde_json::to_value(load_configs()).unwrap()),

        "save-config" => {
            let mut config: BrokerConfig = param(&params, "config")?;
            if config.id.is_empty() {
                config.id = Uuid::new_v4().to_string();
            }
            let mut configs = load_configs();
            if let Some(pos) = configs.iter().position(|c| c.id == config.id) {
                configs[pos] = config.clone();
            } else {
                configs.push(config.clone());
            }
            save_configs(&configs)?;
            Ok(serde_json::to_value(config).unwrap())
        }

        "delete-config" => {
            let config_id: String = param(&params, "configId")?;
            let mut configs = load_configs();
            configs.retain(|c| c.id != config_id);
            save_configs(&configs)?;
            Ok(serde_json::Value::Null)
        }

        "test-connection" => {
            let config_id: String = param(&params, "configId")?;
            let config = find_config(&config_id)?;
            // open_kafka_stream already probes with a MetadataRequest, so success == connected
            open_kafka_stream(&config).await?;
            Ok(serde_json::Value::Null)
        }

        "list-topics" => {
            let config_id: String = param(&params, "configId")?;
            let config = find_config(&config_id)?;
            let mut stream = open_kafka_stream(&config).await?;
            let mut topics = wire_metadata(&mut stream, &[]).await?;
            topics.sort_by(|a, b| a.name.cmp(&b.name));
            Ok(serde_json::to_value(topics).unwrap())
        }

        "topic-details" => {
            let config_id: String = param(&params, "configId")?;
            let topic: String = param(&params, "topic")?;
            let config = find_config(&config_id)?;
            let mut stream = open_kafka_stream(&config).await?;

            let meta = wire_metadata(&mut stream, &[topic.as_str()]).await?;
            let summary = meta.into_iter().find(|t| t.name == topic)
                .ok_or_else(|| format!("Topic '{}' not found", topic))?;

            let partition_ids: Vec<i32> = (0..summary.partition_count).collect();

            let earliest = wire_list_offsets(&mut stream, &topic, &partition_ids, -2).await
                .unwrap_or_default();
            let latest = wire_list_offsets(&mut stream, &topic, &partition_ids, -1).await
                .unwrap_or_default();

            let earliest_map: HashMap<i32, i64> = earliest.into_iter().collect();
            let latest_map: HashMap<i32, i64> = latest.into_iter().collect();

            let partitions: Vec<PartitionInfo> = partition_ids.iter().map(|&id| PartitionInfo {
                id,
                leader: 0,
                earliest_offset: earliest_map.get(&id).copied().unwrap_or(-1),
                latest_offset: latest_map.get(&id).copied().unwrap_or(-1),
            }).collect();

            Ok(serde_json::to_value(TopicDetails {
                name: topic,
                partitions,
                replication_factor: summary.replication_factor,
            }).unwrap())
        }

        "topic-consumer-groups" => {
            let config_id: String = param(&params, "configId")?;
            let topic: String = param(&params, "topic")?;
            let config = find_config(&config_id)?;
            let mut stream = open_kafka_stream(&config).await?;

            let meta = wire_metadata(&mut stream, &[topic.as_str()]).await?;
            let summary = meta.into_iter().find(|t| t.name == topic)
                .ok_or_else(|| format!("Topic '{}' not found", topic))?;
            let partition_ids: Vec<i32> = (0..summary.partition_count).collect();

            let latest: HashMap<i32, i64> =
                wire_list_offsets(&mut stream, &topic, &partition_ids, -1).await
                    .unwrap_or_default()
                    .into_iter()
                    .collect();

            let groups = wire_list_groups(&mut stream).await?;
            const MAX_GROUPS_SCANNED: usize = 500;
            let topics_arg = [(topic.as_str(), partition_ids)];
            let mut result: Vec<GroupLag> = Vec::new();
            for g in groups.iter().take(MAX_GROUPS_SCANNED) {
                match wire_offset_fetch(&mut stream, &g.group_id, Some(&topics_arg)).await {
                    Ok(offsets) => {
                        for (_t, partition, committed_offset) in offsets {
                            let latest_off = latest.get(&partition).copied().unwrap_or(-1);
                            let lag = if latest_off >= 0 && committed_offset >= 0 {
                                latest_off - committed_offset
                            } else {
                                -1
                            };
                            result.push(GroupLag { group_id: g.group_id.clone(), partition, committed_offset, lag });
                        }
                    }
                    Err(_) => break,
                }
            }
            result.sort_by(|a, b| a.group_id.cmp(&b.group_id).then(a.partition.cmp(&b.partition)));
            Ok(serde_json::to_value(result).unwrap())
        }

        "topic-configs" => {
            let config_id: String = param(&params, "configId")?;
            let topic: String = param(&params, "topic")?;
            let config = find_config(&config_id)?;
            let mut stream = open_kafka_stream(&config).await?;
            Ok(serde_json::to_value(wire_describe_configs(&mut stream, &topic).await?).unwrap())
        }

        "create-topic" => {
            let config_id: String = param(&params, "configId")?;
            let name: String = param(&params, "name")?;
            let num_partitions: i32 = param(&params, "numPartitions")?;
            let replication_factor: i16 = param(&params, "replicationFactor")?;
            validate_create_topic(&name, num_partitions, replication_factor)?;
            let config = find_config(&config_id)?;
            let client = make_client(&config).await?;
            let controller = client.controller_client().map_err(|e| e.to_string())?;
            controller
                .create_topic(name, num_partitions, replication_factor, 5_000)
                .await
                .map_err(|e| e.to_string())?;
            Ok(serde_json::Value::Null)
        }

        "delete-topic" => {
            let config_id: String = param(&params, "configId")?;
            let name: String = param(&params, "name")?;
            let config = find_config(&config_id)?;
            let client = make_client(&config).await?;
            let controller = client.controller_client().map_err(|e| e.to_string())?;
            controller
                .delete_topic(name, 5_000)
                .await
                .map_err(|e| e.to_string())?;
            Ok(serde_json::Value::Null)
        }

        "list-groups" => {
            let config_id: String = param(&params, "configId")?;
            let config = find_config(&config_id)?;
            let mut stream = open_kafka_stream(&config).await?;
            let mut groups = wire_list_groups(&mut stream).await?;

            if !groups.is_empty() {
                let gids: Vec<&str> = groups.iter().map(|g| g.group_id.as_str()).collect();
                if let Ok(details) = wire_describe_groups(&mut stream, &gids).await {
                    let state_map: HashMap<String, String> =
                        details.into_iter().map(|(id, state, _members)| (id, state)).collect();
                    for g in &mut groups {
                        if let Some(state) = state_map.get(&g.group_id) {
                            g.state = state.clone();
                        }
                    }
                }
            }

            groups.sort_by(|a, b| a.group_id.cmp(&b.group_id));
            Ok(serde_json::to_value(groups).unwrap())
        }

        "group-details" => {
            let config_id: String = param(&params, "configId")?;
            let group_id: String = param(&params, "groupId")?;
            let config = find_config(&config_id)?;
            let mut stream = open_kafka_stream(&config).await?;

            let desc = wire_describe_groups(&mut stream, &[group_id.as_str()]).await?;
            let (state, members_raw) = desc
                .into_iter()
                .find(|(id, _, _)| id == &group_id)
                .map(|(_, s, m)| (s, m))
                .unwrap_or_else(|| (String::from("Unknown"), Vec::new()));
            let member_count = members_raw.len() as i32;

            let owner_map: HashMap<(String, i32), GroupMember> = members_raw
                .iter()
                .flat_map(|mw| {
                    let member = mw.member.clone();
                    mw.owned
                        .iter()
                        .map(move |(t, p)| ((t.clone(), *p), member.clone()))
                })
                .collect();
            let members: Vec<GroupMember> = members_raw.into_iter().map(|mw| mw.member).collect();

            let committed = wire_offset_fetch(&mut stream, &group_id, None).await
                .unwrap_or_default();

            let mut by_topic: HashMap<String, Vec<(i32, i64)>> = HashMap::new();
            for (topic, partition, committed_offset) in committed {
                by_topic.entry(topic).or_default().push((partition, committed_offset));
            }

            let mut assignments = Vec::new();
            for (topic, parts) in by_topic {
                let pids: Vec<i32> = parts.iter().map(|(p, _)| *p).collect();
                let latest_map: HashMap<i32, i64> =
                    wire_list_offsets(&mut stream, &topic, &pids, -1).await
                        .unwrap_or_default()
                        .into_iter()
                        .collect();
                for (partition, committed_offset) in parts {
                    let latest = latest_map.get(&partition).copied().unwrap_or(-1);
                    let lag = if latest >= 0 && committed_offset >= 0 {
                        latest - committed_offset
                    } else {
                        -1
                    };
                    let owner = owner_map.get(&(topic.clone(), partition));
                    assignments.push(Assignment {
                        topic: topic.clone(),
                        partition,
                        committed_offset,
                        lag,
                        client_id: owner.map(|m| m.client_id.clone()),
                        client_host: owner.map(|m| m.client_host.clone()),
                        member_id: owner.map(|m| m.member_id.clone()),
                    });
                }
            }

            assignments.sort_by(|a, b| a.topic.cmp(&b.topic).then(a.partition.cmp(&b.partition)));

            Ok(serde_json::to_value(GroupDetails { group_id, state, member_count, members, assignments }).unwrap())
        }

        "produce" => {
            let config_id: String = param(&params, "configId")?;
            let topic: String = param(&params, "topic")?;
            let partition: Option<i32> = opt_param(&params, "partition");
            let key: Option<String> = opt_param(&params, "key");
            let value: String = param(&params, "value")?;
            let headers: Option<HashMap<String, String>> = opt_param(&params, "headers");

            let config = find_config(&config_id)?;
            let client = make_client(&config).await?;
            let part = partition.unwrap_or(0);
            let pc = client
                .partition_client(topic.as_str(), part, UnknownTopicHandling::Retry)
                .await
                .map_err(|e| e.to_string())?;

            let record_headers: std::collections::BTreeMap<String, Vec<u8>> = headers
                .unwrap_or_default()
                .into_iter()
                .map(|(k, v)| (k, v.into_bytes()))
                .collect();

            let record = Record {
                key: key.map(|k| k.into_bytes()),
                value: Some(value.into_bytes()),
                headers: record_headers,
                timestamp: Utc::now(),
            };
            let offsets = pc
                .produce(vec![record], Compression::NoCompression)
                .await
                .map_err(|e| e.to_string())?;

            let offset = offsets.into_iter().next().unwrap_or(-1);
            Ok(serde_json::to_value(ProduceResult { partition: part, offset }).unwrap())
        }

        "produce-batch" => {
            let config_id: String = param(&params, "configId")?;
            let topic: String = param(&params, "topic")?;
            let partition: Option<i32> = opt_param(&params, "partition");
            let records: Vec<BatchRecord> = param(&params, "records")?;

            if records.is_empty() {
                return Err("No records to produce".into());
            }
            const MAX_BATCH_RECORDS: usize = 10_000;
            if records.len() > MAX_BATCH_RECORDS {
                return Err(format!(
                    "Batch too large: {} records (max {MAX_BATCH_RECORDS} per send)",
                    records.len()
                ));
            }
            let config = find_config(&config_id)?;
            let client = make_client(&config).await?;
            let part = partition.unwrap_or(0);
            let pc = client
                .partition_client(topic.as_str(), part, UnknownTopicHandling::Retry)
                .await
                .map_err(|e| e.to_string())?;

            let recs: Vec<Record> = records
                .into_iter()
                .map(|r| Record {
                    key: r.key.map(|k| k.into_bytes()),
                    value: Some(r.value.into_bytes()),
                    headers: r.headers.into_iter().map(|(k, v)| (k, v.into_bytes())).collect(),
                    timestamp: Utc::now(),
                })
                .collect();

            let offsets = pc.produce(recs, Compression::NoCompression)
                .await
                .map_err(|e| e.to_string())?;
            Ok(serde_json::to_value(offsets).unwrap())
        }

        "fetch-messages" => {
            let config_id: String = param(&params, "configId")?;
            let topic: String = param(&params, "topic")?;
            let partition: i32 = param(&params, "partition")?;
            let offset: i64 = param(&params, "offset")?;
            let limit: i32 = param(&params, "limit")?;
            let start_timestamp: Option<i64> = opt_param(&params, "startTimestamp");

            const MAX_FETCH_MESSAGES: i32 = 100_000;
            let limit = limit.clamp(1, MAX_FETCH_MESSAGES);

            let config = find_config(&config_id)?;

            let resolved_from_ts = if let Some(ts_ms) = start_timestamp {
                let mut stream = open_kafka_stream(&config).await?;
                let offs = wire_list_offsets(&mut stream, &topic, &[partition], ts_ms)
                    .await
                    .unwrap_or_default();
                match offs.into_iter().next().map(|(_, o)| o) {
                    Some(o) if o >= 0 => Some(o),
                    _ => return Ok(serde_json::to_value(Vec::<KafkaMessage>::new()).unwrap()),
                }
            } else {
                None
            };

            let client = make_client(&config).await?;
            let pc = client
                .partition_client(topic.as_str(), partition, UnknownTopicHandling::Retry)
                .await
                .map_err(|e| e.to_string())?;

            let start_offset = if let Some(o) = resolved_from_ts {
                o
            } else if offset < 0 {
                let (_, high) = pc.get_offset(OffsetAt::Latest)
                    .await
                    .map(|o| (0i64, o))
                    .unwrap_or((0, 0));
                (high - limit as i64).max(0)
            } else {
                offset
            };

            let bytes_range = 1..10 * 1024 * 1024;
            let (records, _) = pc
                .fetch_records(start_offset, bytes_range, 1000)
                .await
                .map_err(|e| e.to_string())?;

            let messages: Vec<KafkaMessage> = records
                .into_iter()
                .take(limit as usize)
                .map(|ro| {
                    let key = ro.record.key.map(|b| {
                        String::from_utf8(b.clone()).unwrap_or_else(|_| format!("<binary {} bytes>", b.len()))
                    });
                    let value = ro.record.value.map(|b| {
                        String::from_utf8(b.clone()).unwrap_or_else(|_| format!("<binary {} bytes>", b.len()))
                    });
                    let headers = ro.record.headers
                        .into_iter()
                        .map(|(k, v)| (k, String::from_utf8(v.clone()).unwrap_or_else(|_| format!("<binary {} bytes>", v.len()))))
                        .collect();
                    KafkaMessage {
                        offset: ro.offset,
                        partition,
                        timestamp: ro.record.timestamp.to_rfc3339(),
                        key,
                        value,
                        headers,
                    }
                })
                .collect();

            Ok(serde_json::to_value(messages).unwrap())
        }

        // `consume-start` (STREAM) KHÔNG đi qua đây — xem `handle_consume_start`.

        "consume-stop" => {
            let consumer_id: String = param(&params, "consumerId")?;
            if let Some(notify) = registry().inner.lock().unwrap().remove(&consumer_id) {
                notify.notify_one();
            }
            Ok(serde_json::Value::Null)
        }

        other => Err(format!("method không hỗ trợ: \"{other}\"")),
    }
}

fn send_consume_error(tx: &mpsc::UnboundedSender<Response>, id: &str, message: impl Into<String>) {
    let _ = tx.send(Response::event(id.to_string(), serde_json::json!({ "type": "error", "errorMessage": message.into() })));
}

/// `consume-start` là method STREAM — xem file-level comment ở đầu file cho
/// hình dạng sự kiện. Port từ `kafka_consume_start` cũ, chỉ đổi cách phát sự
/// kiện (JSONL stream thay vì `tauri::ipc::Channel`) và cách trả `consumerId`
/// (sự kiện "started" đầu tiên thay vì giá trị trả về một-lần).
async fn handle_consume_start(id: String, params: serde_json::Value, tx: mpsc::UnboundedSender<Response>) {
    let config_id: String = match param(&params, "configId") {
        Ok(v) => v,
        Err(e) => { send_consume_error(&tx, &id, e); return; }
    };
    let topic: String = match param(&params, "topic") {
        Ok(v) => v,
        Err(e) => { send_consume_error(&tx, &id, e); return; }
    };
    let from: String = opt_param(&params, "from").unwrap_or_else(|| "latest".to_string());

    let config = match find_config(&config_id) {
        Ok(c) => c,
        Err(e) => { send_consume_error(&tx, &id, e); return; }
    };

    let mut stream = match open_kafka_stream(&config).await {
        Ok(s) => s,
        Err(e) => { send_consume_error(&tx, &id, e); return; }
    };
    let meta = match wire_metadata(&mut stream, &[topic.as_str()]).await {
        Ok(m) => m,
        Err(e) => { send_consume_error(&tx, &id, e); return; }
    };
    let summary = match meta.into_iter().find(|t| t.name == topic) {
        Some(s) => s,
        None => { send_consume_error(&tx, &id, format!("Topic '{}' not found", topic)); return; }
    };
    drop(stream);
    let partition_count = summary.partition_count;
    if partition_count <= 0 {
        send_consume_error(&tx, &id, format!("Topic '{}' has no partitions", topic));
        return;
    }

    let client = match make_client(&config).await {
        Ok(c) => c,
        Err(e) => { send_consume_error(&tx, &id, e); return; }
    };
    let from_latest = from != "earliest";

    let consumer_id = Uuid::new_v4().to_string();
    let notify = Arc::new(tokio::sync::Notify::new());
    registry().inner.lock().unwrap().insert(consumer_id.clone(), notify.clone());

    if tx
        .send(Response::event(id.clone(), serde_json::json!({ "type": "started", "consumerId": consumer_id })))
        .is_err()
    {
        registry().inner.lock().unwrap().remove(&consumer_id);
        return;
    }

    tokio::spawn(async move {
        let client = client;
        let mut handles = Vec::new();

        for p in 0..partition_count {
            let pc = match client
                .partition_client(topic.as_str(), p, UnknownTopicHandling::Retry)
                .await
            {
                Ok(pc) => pc,
                Err(_) => continue,
            };
            let start = if from_latest {
                pc.get_offset(OffsetAt::Latest).await.unwrap_or(0)
            } else {
                pc.get_offset(OffsetAt::Earliest).await.unwrap_or(0)
            };

            let notify = notify.clone();
            let tx = tx.clone();
            let call_id = id.clone();
            handles.push(tokio::spawn(async move {
                let mut offset = start.max(0);
                loop {
                    tokio::select! {
                        _ = notify.notified() => break,
                        res = pc.fetch_records(offset, 1..(8 * 1024 * 1024), 1000) => match res {
                            Ok((records, _high)) => {
                                for ro in records {
                                    offset = ro.offset + 1;
                                    let (value, value_b64) = match ro.record.value {
                                        Some(b) => (
                                            String::from_utf8(b.clone()).ok(),
                                            Some(base64::engine::general_purpose::STANDARD.encode(&b)),
                                        ),
                                        None => (None, None),
                                    };
                                    let key = ro.record.key.map(|b| {
                                        String::from_utf8(b.clone())
                                            .unwrap_or_else(|_| format!("<binary {} bytes>", b.len()))
                                    });
                                    let headers = ro
                                        .record
                                        .headers
                                        .into_iter()
                                        .map(|(k, v)| {
                                            (
                                                k,
                                                String::from_utf8(v.clone())
                                                    .unwrap_or_else(|_| format!("<binary {} bytes>", v.len())),
                                            )
                                        })
                                        .collect();
                                    let msg = KafkaConsumedMessage {
                                        partition: p,
                                        offset: ro.offset,
                                        timestamp: ro.record.timestamp.to_rfc3339(),
                                        key,
                                        value,
                                        value_b64,
                                        headers,
                                    };
                                    if tx.send(Response::event(call_id.clone(), serde_json::json!({ "type": "message", "message": msg }))).is_err() {
                                        return; // writer task đã thoát — không còn ai đọc phản hồi
                                    }
                                }
                            }
                            Err(_) => {
                                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                            }
                        }
                    }
                }
            }));
        }

        notify.notified().await;
        for h in handles {
            h.abort();
        }
        registry().inner.lock().unwrap().remove(&consumer_id);
    });
}

// ── main: đọc stdin, spawn một task async cho mỗi dòng, một task khác sở hữu
//    stdout để mọi phản hồi ghi ra không bị xen lẫn giữa hai task. ──────────

#[tokio::main]
async fn main() {
    let (tx, mut rx) = mpsc::unbounded_channel::<Response>();

    let writer = tokio::spawn(async move {
        let mut stdout = tokio::io::stdout();
        while let Some(response) = rx.recv().await {
            let Ok(json) = serde_json::to_string(&response) else { continue };
            if stdout.write_all(json.as_bytes()).await.is_err() { break; }
            if stdout.write_all(b"\n").await.is_err() { break; }
            if stdout.flush().await.is_err() { break; }
        }
    });

    let stdin = tokio::io::stdin();
    let mut lines = BufReader::new(stdin).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        if line.trim().is_empty() {
            continue;
        }
        let tx = tx.clone();
        tokio::spawn(async move {
            handle_line(&line, &tx).await;
        });
    }

    drop(tx);
    let _ = writer.await;
}

async fn handle_line(line: &str, tx: &mpsc::UnboundedSender<Response>) {
    let req: Request = match serde_json::from_str(line) {
        Ok(r) => r,
        Err(e) => {
            let _ = tx.send(Response::err(String::new(), format!("JSON không hợp lệ: {e}")));
            return;
        }
    };
    if req.protocol != SERVICE_PROTOCOL {
        let _ = tx.send(Response::err(req.id, format!("lệch protocol: client {}, sidecar {SERVICE_PROTOCOL}", req.protocol)));
        return;
    }
    if req.method == "consume-start" {
        handle_consume_start(req.id, req.params, tx.clone()).await;
        return;
    }
    let response = match handle(&req.method, req.params).await {
        Ok(value) if value.is_null() => Response::ok(req.id),
        Ok(value) => Response::once(req.id, value),
        Err(e) => Response::err(req.id, e),
    };
    let _ = tx.send(response);
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── parse_brokers ──────────────────────────────────────────────────────
    #[test]
    fn parse_brokers_handles_whitespace_and_empties() {
        assert_eq!(parse_brokers("localhost:9092"), vec!["localhost:9092"]);
        assert_eq!(parse_brokers("a:1, b:2 , c:3"), vec!["a:1", "b:2", "c:3"]);
        assert_eq!(parse_brokers("  ,  , a:1 ,"), vec!["a:1"]);
        assert!(parse_brokers("").is_empty());
        assert!(parse_brokers("   ").is_empty());
        assert!(parse_brokers(",,,").is_empty());
    }

    // ── validate_create_topic ──────────────────────────────────────────────
    #[test]
    fn validate_create_topic_accepts_sane_input() {
        assert!(validate_create_topic("orders", 3, 1).is_ok());
        assert!(validate_create_topic("t", 1, 1).is_ok());
        assert!(validate_create_topic("t", 10_000, 3).is_ok());
    }

    #[test]
    fn validate_create_topic_rejects_bad_input() {
        assert!(validate_create_topic("", 1, 1).is_err());
        assert!(validate_create_topic("   ", 1, 1).is_err());
        assert!(validate_create_topic("t", 0, 1).is_err());
        assert!(validate_create_topic("t", -1, 1).is_err());
        assert!(validate_create_topic("t", 10_001, 1).is_err());
        assert!(validate_create_topic("t", 3, 0).is_err());
        assert!(validate_create_topic("t", 3, -1).is_err());
    }

    // ── encode/decode round-trips ──────────────────────────────────────────
    #[test]
    fn enc_str_round_trips_through_dec() {
        let mut buf = Vec::new();
        enc_str(&mut buf, "demo-events");
        let mut d = Dec::new(&buf);
        assert_eq!(d.str().unwrap(), "demo-events");
    }

    #[test]
    fn enc_i32_i64_round_trip() {
        let mut buf = Vec::new();
        enc_i32(&mut buf, -123);
        enc_i64(&mut buf, 9_000_000_000);
        let mut d = Dec::new(&buf);
        assert_eq!(d.i32().unwrap(), -123);
        assert_eq!(d.i64().unwrap(), 9_000_000_000);
    }

    // ── Dec primitives ─────────────────────────────────────────────────────
    #[test]
    fn dec_reads_fixed_width_big_endian() {
        let mut d = Dec::new(&[0x12, 0x34, 0x00, 0x00, 0x00, 0x2A]);
        assert_eq!(d.i16().unwrap(), 0x1234);
        assert_eq!(d.i32().unwrap(), 42);
    }

    #[test]
    fn dec_ensure_guards_short_buffers() {
        assert!(Dec::new(&[0x00]).i32().is_err());
        assert!(Dec::new(&[]).i16().is_err());
        // bytes() with a length longer than the remaining buffer must error.
        assert!(Dec::new(&[0, 0, 0, 5, b'a']).bytes().is_err());
    }

    #[test]
    fn dec_string_and_bytes() {
        // string: i16 len=3 then "abc"
        let mut d = Dec::new(&[0, 3, b'a', b'b', b'c']);
        assert_eq!(d.str().unwrap(), "abc");
        // bytes: i32 len=2 then 0xDE 0xAD
        let mut d = Dec::new(&[0, 0, 0, 2, 0xDE, 0xAD]);
        assert_eq!(d.bytes().unwrap(), vec![0xDE, 0xAD]);
    }

    #[test]
    fn dec_negative_lengths_are_null_like() {
        // i16 = -1 → empty string
        assert_eq!(Dec::new(&[0xFF, 0xFF]).str().unwrap(), "");
        // i16 = -1 → None for nullable_str
        assert_eq!(Dec::new(&[0xFF, 0xFF]).nullable_str().unwrap(), None);
        // i32 = -1 → empty Vec for bytes
        assert_eq!(Dec::new(&[0xFF, 0xFF, 0xFF, 0xFF]).bytes().unwrap(), Vec::<u8>::new());
    }

    #[test]
    fn dec_array_reads_each_element() {
        // count=2 then two i32 values 10, 20
        let bytes = [0, 0, 0, 2, 0, 0, 0, 10, 0, 0, 0, 20];
        let mut d = Dec::new(&bytes);
        let out = d.array(|d| d.i32()).unwrap();
        assert_eq!(out, vec![10, 20]);
    }

    #[test]
    fn dec_array_negative_count_is_empty() {
        let mut d = Dec::new(&[0xFF, 0xFF, 0xFF, 0xFF]);
        let out: Vec<i32> = d.array(|d| d.i32()).unwrap();
        assert!(out.is_empty());
    }

    #[test]
    fn dec_array_count_exceeding_buffer_is_rejected() {
        // count = 1000 but no element bytes follow → must error early, not spin.
        let mut d = Dec::new(&[0, 0, 0x03, 0xE8]);
        let res = d.array(|d| d.i32());
        assert!(res.is_err());
        assert!(res.unwrap_err().contains("exceeds remaining buffer"));
    }

    // ── parse_member_assignment ────────────────────────────────────────────
    fn build_assignment(topics: &[(&str, &[i32])]) -> Vec<u8> {
        let mut b = Vec::new();
        b.extend_from_slice(&0i16.to_be_bytes()); // version
        b.extend_from_slice(&(topics.len() as i32).to_be_bytes());
        for (topic, parts) in topics {
            enc_str(&mut b, topic);
            b.extend_from_slice(&(parts.len() as i32).to_be_bytes());
            for &p in *parts {
                b.extend_from_slice(&p.to_be_bytes());
            }
        }
        b.extend_from_slice(&0i32.to_be_bytes()); // userdata: empty bytes
        b
    }

    #[test]
    fn parse_member_assignment_decodes_owned_partitions() {
        let blob = build_assignment(&[("demo-events", &[0, 2]), ("orders", &[5])]);
        let owned = parse_member_assignment(&blob);
        assert_eq!(
            owned,
            vec![
                ("demo-events".to_string(), 0),
                ("demo-events".to_string(), 2),
                ("orders".to_string(), 5),
            ]
        );
    }

    #[test]
    fn parse_member_assignment_is_tolerant_of_empty_and_garbage() {
        assert!(parse_member_assignment(&[]).is_empty());
        // Only a version, no topic array → tolerated as empty, never panics.
        assert!(parse_member_assignment(&[0, 0]).is_empty());
        // Truncated topic array length → tolerated.
        assert!(parse_member_assignment(&[0, 0, 0, 0, 0, 5]).is_empty());
    }

    // ── Test riêng cho phần hạ tầng chỉ có ở sidecar (không có trong kafka.rs) ─

    #[test]
    fn app_data_dir_bao_loi_ro_rang_khi_thieu_bien_moi_truong() {
        if std::env::var("DEVTOOL_SERVICE_DATA_DIR").is_err() {
            assert!(app_data_dir().unwrap_err().contains("DEVTOOL_SERVICE_DATA_DIR"));
        }
    }
}
