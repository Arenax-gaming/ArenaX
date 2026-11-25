//! Stellar RPC adapter. Horizon is not a Soroban JSON-RPC endpoint.
use super::soroban_event_poller::{EventPage, EventSource, LedgerWindow, PAGE_SIZE};
use anyhow::{bail, ensure, Result};
use async_trait::async_trait;
use serde::de::DeserializeOwned;
use serde_json::{json, Value};
use std::time::Duration;

pub struct SorobanService {
    client: reqwest::Client,
    rpc_url: reqwest::Url,
}

impl SorobanService {
    pub fn new(rpc_url: &str) -> Result<Self> {
        let rpc_url = reqwest::Url::parse(rpc_url)?;
        ensure!(
            matches!(rpc_url.scheme(), "http" | "https"),
            "RPC URL must be HTTP(S)"
        );
        Ok(Self {
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(30))
                .build()?,
            rpc_url,
        })
    }

    async fn rpc<T: DeserializeOwned>(&self, method: &str, params: Value) -> Result<T> {
        let response: Value = self
            .client
            .post(self.rpc_url.clone())
            .json(&json!({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}))
            .send()
            .await
            .map_err(reqwest::Error::without_url)?
            .error_for_status()
            .map_err(reqwest::Error::without_url)?
            .json()
            .await
            .map_err(reqwest::Error::without_url)?;
        if let Some(error) = response.get("error") {
            bail!("Stellar RPC {method}: {error}");
        }
        let result = response
            .get("result")
            .ok_or_else(|| anyhow::anyhow!("RPC response missing result"))?;
        Ok(serde_json::from_value(result.clone())?)
    }
}

#[async_trait]
impl EventSource for SorobanService {
    async fn ledger_window(&self) -> Result<LedgerWindow> {
        self.rpc("getHealth", json!({})).await
    }

    async fn event_page(
        &self,
        ledger: u32,
        cursor: Option<&str>,
        contracts: &[String],
    ) -> Result<EventPage> {
        let mut params = json!({
            "filters": [{"type": "contract", "contractIds": contracts}],
            "pagination": {"limit": PAGE_SIZE}
        });
        if let Some(cursor) = cursor {
            params["pagination"]["cursor"] = json!(cursor);
        } else {
            params["startLedger"] = json!(ledger);
            params["endLedger"] = json!(ledger
                .checked_add(1)
                .ok_or_else(|| anyhow::anyhow!("ledger overflow"))?);
        }
        self.rpc("getEvents", params).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    async fn server(responses: Vec<Value>) -> (String, tokio::task::JoinHandle<Vec<Value>>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let task = tokio::spawn(async move {
            let mut requests = vec![];
            for response in responses {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut bytes = Vec::new();
                let (header_end, length) = loop {
                    let mut buffer = [0; 1024];
                    let count = socket.read(&mut buffer).await.unwrap();
                    assert!(count > 0);
                    bytes.extend_from_slice(&buffer[..count]);
                    if let Some(end) = bytes.windows(4).position(|b| b == b"\r\n\r\n") {
                        let header = String::from_utf8_lossy(&bytes[..end]);
                        let length = header
                            .lines()
                            .find_map(|line| {
                                let (name, value) = line.split_once(':')?;
                                name.eq_ignore_ascii_case("content-length")
                                    .then(|| value.trim().parse::<usize>().unwrap())
                            })
                            .unwrap();
                        break (end + 4, length);
                    }
                };
                while bytes.len() < header_end + length {
                    let mut buffer = [0; 1024];
                    let count = socket.read(&mut buffer).await.unwrap();
                    assert!(count > 0);
                    bytes.extend_from_slice(&buffer[..count]);
                }
                requests
                    .push(serde_json::from_slice(&bytes[header_end..header_end + length]).unwrap());
                let body = response.to_string();
                let reply = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body);
                socket.write_all(reply.as_bytes()).await.unwrap();
            }
            requests
        });
        (url, task)
    }

    #[tokio::test]
    async fn sends_bounded_first_page_and_exclusive_cursor_requests() {
        let (url, task) = server(vec![
            json!({"result": {"oldestLedger": 1, "latestLedger": 99}}),
            json!({"result": {"events": [], "cursor": "next"}}),
            json!({"result": {"events": [], "cursor": "end"}}),
        ])
        .await;
        let rpc = SorobanService::new(&url).unwrap();
        assert_eq!(rpc.ledger_window().await.unwrap().latest_ledger, 99);
        rpc.event_page(10, None, &["contract".into()])
            .await
            .unwrap();
        rpc.event_page(10, Some("next"), &["contract".into()])
            .await
            .unwrap();
        let requests = task.await.unwrap();
        assert_eq!(requests[0]["method"], "getHealth");
        assert_eq!(requests[1]["method"], "getEvents");
        assert_eq!(requests[1]["params"]["startLedger"], 10);
        assert_eq!(requests[1]["params"]["endLedger"], 11);
        assert!(requests[1]["params"]["pagination"].get("cursor").is_none());
        assert_eq!(requests[2]["params"]["pagination"]["cursor"], "next");
        assert!(requests[2]["params"].get("startLedger").is_none());
        assert!(requests[2]["params"].get("endLedger").is_none());
        assert_eq!(requests[2]["params"]["pagination"]["limit"], PAGE_SIZE);
        assert_eq!(
            requests[2]["params"]["filters"][0]["contractIds"],
            json!(["contract"])
        );
    }

    #[tokio::test]
    async fn propagates_rpc_errors_and_invalid_responses() {
        let (url, task) = server(vec![
            json!({"error": {"code": -1, "message": "history unavailable"}}),
            json!({"unexpected": true}),
        ])
        .await;
        let rpc = SorobanService::new(&url).unwrap();
        assert!(rpc
            .ledger_window()
            .await
            .unwrap_err()
            .to_string()
            .contains("history unavailable"));
        assert!(rpc
            .ledger_window()
            .await
            .unwrap_err()
            .to_string()
            .contains("missing result"));
        task.await.unwrap();
    }
}
