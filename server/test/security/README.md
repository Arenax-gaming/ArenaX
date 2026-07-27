# OWASP ZAP Security Testing for ArenaX API

This directory contains security testing configurations and scripts for automated vulnerability scanning using OWASP ZAP.

## Overview

OWASP ZAP (Zed Attack Proxy) is a free, open-source penetration testing tool for finding vulnerabilities in web applications and APIs. This implementation provides automated security scanning for the ArenaX API.

## Setup

### Prerequisites

1. **Install OWASP ZAP CLI**:
   ```bash
   pip install zap-cli
   ```

2. **Or use Docker** (recommended):
   ```bash
   docker pull zaproxy/zap-stable:latest
   ```

### Configuration

Edit `zap-config.yaml` to customize:
- Target URLs
- Authentication settings
- Scan policies
- Alert thresholds
- Report formats

## Usage

### Quick Scan

Run a quick security scan against the API:

```bash
# Set your API base URL and token
export API_BASE_URL="http://localhost:3001/api"
export API_TOKEN="your-jwt-token"

# Run the scan
./test/security/run-zap-scan.sh
```

### Manual Scan with ZAP CLI

```bash
# Start ZAP daemon
zap-cli start -p 8080

# Run spider to discover endpoints
zap-cli spider http://localhost:3001/api

# Run active scan
zap-cli active-scan http://localhost:3001/api

# Generate reports
zap-cli report -o report.html -f html
zap-cli report -o report.json -f json

# Shutdown ZAP
zap-cli shutdown
```

### Docker-based Scan

```bash
# Run ZAP in Docker
docker run -d \
    --name zap-scan \
    -p 8080:8080 \
    -w /zap/wrk \
    zaproxy/zap-stable:latest \
    zap.sh -daemon -host 0.0.0.0 -port 8080

# Run scan
zap-cli quick-scan --self-contained http://localhost:3001/api

# Cleanup
docker stop zap-scan
docker rm zap-scan
```

## Scan Policies

### Active Scan Rules

The following vulnerability types are scanned:
- SQL Injection
- NoSQL Injection
- Command Injection
- XSS (Cross-Site Scripting)
- CSRF (Cross-Site Request Forgery)
- Path Traversal
- File Inclusion
- XXE (XML External Entity)
- SSRF (Server-Side Request Forgery)
- Open Redirect
- Deserialization
- And many more...

### Passive Scan Rules

Passive scanning checks for:
- Security headers (CSP, HSTS, X-Frame-Options, etc.)
- Cookie security attributes
- Information disclosure
- Server version disclosure
- Directory listing
- And more...

## Reports

Reports are generated in multiple formats:
- **HTML**: Interactive web report (`zap-report-<timestamp>.html`)
- **JSON**: Machine-readable format (`zap-report-<timestamp>.json`)
- **XML**: Structured data (`zap-report-<timestamp>.xml`)
- **Markdown**: Documentation format (`zap-report-<timestamp>.md`)

Reports are saved to `./test/security/reports/`.

## CI/CD Integration

Add to your CI/CD pipeline:

```yaml
# GitHub Actions example
- name: Security Scan with OWASP ZAP
  run: |
    export API_BASE_URL="http://localhost:3001/api"
    ./test/security/run-zap-scan.sh
  continue-on-error: false
```

## Alert Thresholds

- **High**: 0 (fail if any high severity issues found)
- **Medium**: 5 (fail if more than 5 medium issues)
- **Low**: 20 (fail if more than 20 low issues)
- **Informational**: 50 (fail if more than 50 informational issues)

## Security Best Practices

1. **Run scans regularly**: Integrate into CI/CD pipeline
2. **Review reports**: Analyze findings and prioritize fixes
3. **Update ZAP**: Keep ZAP updated for latest vulnerability rules
4. **Custom policies**: Tailor scan policies to your application
5. **False positives**: Mark and exclude false positives
6. **Authentication**: Configure proper authentication for authenticated endpoints

## Troubleshooting

### ZAP fails to start
- Check if port 8080 is available
- Ensure Docker is running (if using Docker)
- Verify ZAP installation

### Scan takes too long
- Reduce spider depth in configuration
- Limit number of pages to scan
- Disable AJAX spider if not needed

### Too many false positives
- Adjust alert thresholds
- Exclude specific URLs
- Customize scan policies

## Compliance

This security testing helps with:
- OWASP Top 10 compliance
- PCI DSS requirements
- SOC 2 security controls
- GDPR security measures

## Resources

- [OWASP ZAP Documentation](https://www.zaproxy.org/docs/)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [ArenaX API Documentation](http://localhost:3001/redoc)
