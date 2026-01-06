# Kamal Configuration Reference

Complete reference for `config/deploy.yml` options.

## Table of Contents
1. [Core Settings](#core-settings)
2. [Servers & Roles](#servers--roles)
3. [Registry](#registry)
4. [Proxy](#proxy)
5. [Environment Variables](#environment-variables)
6. [Builder](#builder)
7. [Accessories](#accessories)
8. [SSH](#ssh)
9. [Hooks](#hooks)
10. [Advanced Options](#advanced-options)

## Core Settings

```yaml
# Required
service: my-app                    # Container name prefix
image: username/my-app             # Docker image name

# Optional
primary_role: web                  # Default role (default: web)
deploy_timeout: 30                 # Container readiness timeout in seconds
drain_timeout: 30                  # Container drain wait in seconds
readiness_delay: 7                 # Wait before checking container boot
retain_containers: 5               # Old containers/images to keep
minimum_version: 2.0.0             # Required Kamal version
```

## Servers & Roles

### Simple (single role)
```yaml
servers:
  - 172.0.0.1
  - 172.0.0.2
```

### With tags
```yaml
servers:
  - 172.0.0.1
  - 172.0.0.2: experiments
  - 172.0.0.3: [ experiments, canary ]
```

### Multiple roles
```yaml
servers:
  web:
    hosts:
      - 172.0.0.1
      - 172.0.0.2
    options:
      memory: 2g
      cpus: 4

  workers:
    hosts:
      - 172.0.0.3
    cmd: bin/jobs
    proxy: false
    options:
      memory: 4g
    labels:
      role: worker
    env:
      clear:
        QUEUE: default,mailers
```

### Role options
```yaml
servers:
  web:
    hosts: [...]
    cmd: bin/rails server          # Custom command
    options:                        # Docker run options
      memory: 2g
      cpus: 4
    labels:                         # Container labels
      app: myapp
    logging:                        # Docker logging config
      driver: json-file
      options:
        max-size: 100m
    proxy: true                     # Enable/disable proxy (default: true for primary)
    asset_path: /app/public/assets  # Asset bridging path
```

## Registry

### Docker Hub
```yaml
registry:
  username: myuser
  password:
    - KAMAL_REGISTRY_PASSWORD
```

### GitHub Container Registry
```yaml
registry:
  server: ghcr.io
  username: myuser
  password:
    - KAMAL_REGISTRY_PASSWORD      # Use PAT with write:packages
```

### AWS ECR
```yaml
registry:
  server: 123456789.dkr.ecr.us-east-1.amazonaws.com
  username: AWS
  password:
    - KAMAL_REGISTRY_PASSWORD      # Use aws ecr get-login-password
```

### Google Container Registry
```yaml
registry:
  server: gcr.io
  username: _json_key
  password:
    - KAMAL_REGISTRY_PASSWORD      # Base64 encoded service account JSON
```

## Proxy

```yaml
proxy:
  # Routing
  host: myapp.com                   # Single domain
  hosts:                            # Multiple domains
    - myapp.com
    - www.myapp.com
  app_port: 80                      # Container port (default: 80)

  # Path-based routing
  path_prefix: /api                 # Route /api/* to this app
  strip_path_prefix: true           # Remove prefix before forwarding

  # SSL
  ssl: true                         # Auto Let's Encrypt
  ssl_redirect: true                # HTTP -> HTTPS redirect (default: true)

  # Custom SSL certificate
  ssl:
    certificate_pem:
      - SSL_CERTIFICATE
    private_key_pem:
      - SSL_PRIVATE_KEY

  # Health checks
  healthcheck:
    interval: 3                     # Seconds between checks
    path: /up                       # Endpoint to check
    timeout: 3                      # Request timeout

  # Buffering
  buffering:
    max_request_body: 1073741824    # 1GB default
    max_response_body: 0            # Unlimited
    memory: 1048576                 # 1MB before disk buffering

  # Timeouts
  response_timeout: 30              # Seconds

  # Headers
  forward_headers: true             # Forward X-Forwarded-* headers

  # Runtime options
  run:
    http_port: 80
    https_port: 443
    log_level: info                 # error, warn, info, debug
```

## Environment Variables

```yaml
env:
  # Clear values (visible in config)
  clear:
    RAILS_ENV: production
    DATABASE_HOST: localhost

  # Secret values (from .kamal/secrets)
  secret:
    - RAILS_MASTER_KEY
    - DATABASE_URL
    - REDIS_URL

  # Aliased secrets (different name in container)
  secret:
    - DB_PASSWORD:MAIN_DATABASE_PASSWORD

  # Tag-specific env vars
  tags:
    experiments:
      clear:
        FEATURE_FLAGS: experimental
```

### Secrets file (.kamal/secrets)
```bash
KAMAL_REGISTRY_PASSWORD=ghp_xxxx
RAILS_MASTER_KEY=abc123
DATABASE_URL=postgres://user:pass@host:5432/db
```

For destinations: `.kamal/secrets.staging`, `.kamal/secrets.production`
Common secrets: `.kamal/secrets-common`

## Builder

```yaml
builder:
  # Architecture
  arch: amd64                       # or arm64, or [amd64, arm64]

  # Build context
  context: .                        # Build from local checkout
  dockerfile: Dockerfile.production # Custom Dockerfile
  target: production                # Multi-stage build target

  # Build arguments
  args:
    RUBY_VERSION: 3.3
    NODE_VERSION: 20

  # Build secrets
  secrets:
    - GITHUB_TOKEN

  # Remote builder
  remote: ssh://docker@builder-host
  local: true                       # Also use local for matching arch

  # Caching
  cache:
    type: gha                       # GitHub Actions cache
    # or
    type: registry
    image: myuser/my-app-cache

  # Driver
  driver: docker-container          # or docker, or cloud://org/project

  # Buildpacks (alternative to Dockerfile)
  buildpack:
    builder: heroku/builder:22
    buildpacks:
      - heroku/ruby
      - heroku/nodejs
```

## Accessories

```yaml
accessories:
  db:
    image: postgres:16
    host: 172.0.0.1                 # Single host
    # or
    hosts:                          # Multiple hosts
      - 172.0.0.1
      - 172.0.0.2
    # or
    roles:                          # Deploy to role hosts
      - web

    port: 5432                      # Exposed port

    env:
      clear:
        POSTGRES_DB: app_production
      secret:
        - POSTGRES_PASSWORD

    # Persistent data
    directories:
      - data:/var/lib/postgresql/data

    # Config files (supports ERB)
    files:
      - config/postgres.conf:/etc/postgresql/postgresql.conf

    # Docker options
    options:
      memory: 2g
      cpus: 2

    cmd: postgres -c 'max_connections=200'

  redis:
    image: redis:7
    host: 172.0.0.1
    port: 6379
    directories:
      - data:/data
    cmd: redis-server --appendonly yes

  search:
    image: elasticsearch:8.11.0
    host: 172.0.0.1
    port: 9200
    env:
      clear:
        discovery.type: single-node
        ES_JAVA_OPTS: -Xms512m -Xmx512m
    directories:
      - data:/usr/share/elasticsearch/data
```

## SSH

```yaml
ssh:
  user: deploy                      # Default: root
  port: 22                          # Default: 22

  # Proxy/jump host
  proxy: user@bastion.example.com
  # or
  proxy_command: ssh -W %h:%p bastion

  # Keys
  keys:
    - ~/.ssh/deploy_key
  keys_only: true                   # Ignore ssh-agent

  # Key data from secrets
  key_data:
    - SSH_PRIVATE_KEY

  # Logging
  log_level: fatal                  # fatal, error, warn, info, debug

  # Config file
  config: true                      # Use ~/.ssh/config (default)
  # or
  config: false                     # Ignore config
  # or
  config: /path/to/ssh_config       # Custom config
```

## Hooks

Hooks are scripts in `.kamal/hooks/` (no file extension).

### Available hooks
- `docker-setup` - After Docker installation
- `pre-connect` - Before connecting to hosts
- `pre-build` - Before building image
- `pre-deploy` - Before deployment
- `post-deploy` - After deployment completes
- `pre-app-boot` - Before app container starts
- `post-app-boot` - After app container starts
- `pre-proxy-reboot` - Before proxy restart
- `post-proxy-reboot` - After proxy restart

### Environment variables in hooks
```bash
KAMAL_RECORDED_AT    # Timestamp
KAMAL_PERFORMER      # User running command
KAMAL_SERVICE        # Service name
KAMAL_VERSION        # Git commit SHA
KAMAL_HOSTS          # Target hosts
KAMAL_COMMAND        # Kamal command (deploy, setup, etc.)
KAMAL_SUBCOMMAND     # Subcommand if any
KAMAL_DESTINATION    # Destination if specified
KAMAL_ROLE           # Role if applicable
```

### Custom hooks path
```yaml
hooks_path: .deploy/hooks
```

## Advanced Options

```yaml
# Asset bridging (Rails)
asset_path: /app/public/assets

# Volumes
volumes:
  - /host/path:/container/path
  - storage:/app/storage:ro

# Labels
labels:
  app: myapp
  env: production

# Logging
logging:
  driver: json-file
  options:
    max-size: 100m
    max-file: 3

# Boot options
boot:
  limit: 10%                        # Rolling deploy percentage
  wait: 10                          # Seconds between batches

# Require destination flag
require_destination: true

# Allow empty roles
allow_empty_roles: true

# Custom secrets path
secrets_path: config/secrets

# Custom run directory
run_directory: /var/kamal

# Error pages
error_pages_path: public/errors
```

## Destinations

Base config: `config/deploy.yml`
Destination config: `config/deploy.staging.yml`

Destination configs are merged with base. Example:

```yaml
# config/deploy.staging.yml
servers:
  - staging.example.com

proxy:
  host: staging.example.com

env:
  clear:
    RAILS_ENV: staging
```

Deploy: `kamal deploy -d staging`
