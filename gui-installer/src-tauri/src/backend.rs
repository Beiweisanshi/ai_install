use std::collections::HashMap;

use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
pub struct BackendRequest {
    pub method: String,
    pub url: String,
    pub headers: Option<HashMap<String, String>>,
    pub body: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BackendResponse {
    pub status: u16,
    pub body: String,
}

pub async fn request_backend(input: BackendRequest) -> Result<BackendResponse, String> {
    validate_url(&input.url)?;

    let method = input
        .method
        .parse::<reqwest::Method>()
        .map_err(|error| format!("Invalid backend request method: {error}"))?;

    let client = reqwest::Client::new();
    let mut request = client.request(method, &input.url).headers(parse_headers(input.headers)?);

    if let Some(body) = input.body {
        request = request.body(body);
    }

    let response = request
        .send()
        .await
        .map_err(|error| format!("Backend request failed: {error}"))?;
    let status = response.status().as_u16();
    let body = response
        .text()
        .await
        .map_err(|error| format!("Failed to read backend response: {error}"))?;

    Ok(BackendResponse { status, body })
}

fn validate_url(url: &str) -> Result<(), String> {
    if url.starts_with("http://") || url.starts_with("https://") {
        Ok(())
    } else {
        Err("Backend URL must start with http:// or https://".to_string())
    }
}

fn parse_headers(headers: Option<HashMap<String, String>>) -> Result<HeaderMap, String> {
    let mut map = HeaderMap::new();

    for (name, value) in headers.unwrap_or_default() {
        let name = HeaderName::from_bytes(name.as_bytes())
            .map_err(|error| format!("Invalid backend request header name: {error}"))?;
        let value = HeaderValue::from_str(&value)
            .map_err(|error| format!("Invalid backend request header value: {error}"))?;
        map.insert(name, value);
    }

    Ok(map)
}
