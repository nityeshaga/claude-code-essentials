# Kamal Troubleshooting Guide

## Table of Contents
1. [Deployment Issues](#deployment-issues)
2. [Container Issues](#container-issues)
3. [Proxy & SSL Issues](#proxy--ssl-issues)
4. [Registry Issues](#registry-issues)
5. [SSH Issues](#ssh-issues)
6. [Accessory Issues](#accessory-issues)
7. [Performance Issues](#performance-issues)
8. [Debugging Commands](#debugging-commands)

## Deployment Issues

### Container not healthy

**Symptoms:** Deploy hangs or fails with health check errors.

**Solutions:**
1. Check your health endpoint:
   ```bash
   curl http://localhost:3000/up  # locally
   kamal app exec -i 'curl localhost/up'  # on server
   ```

2. Increase timeouts for slow-booting apps:
   ```yaml
   deploy_timeout: 120
   readiness_delay: 15
   ```

3. Check container logs:
   ```bash
   kamal app logs
   kamal app logs -f  # follow
   ```

4. Verify health check config:
   ```yaml
   proxy:
     healthcheck:
       path: /up        # Must return 200
       interval: 3
       timeout: 10
   ```

### Deploy stuck / Lock issues

**Symptoms:** Deploy hangs saying "waiting for lock".

**Solutions:**
```bash
# Check lock status
kamal lock status

# Release stale lock
kamal lock release

# Force deploy (dangerous)
kamal deploy --skip_hooks
```

### Rollback not working

**Symptoms:** `kamal rollback` fails or has no effect.

**Solutions:**
```bash
# List available versions
kamal app containers

# Rollback to specific version
kamal rollback abc123def

# Check retained containers setting
# In deploy.yml:
retain_containers: 5
```

## Container Issues

### Container keeps restarting

**Symptoms:** Container starts then immediately exits.

**Debugging:**
```bash
# Check exit code
kamal app details

# View all logs
kamal app logs --lines 500

# SSH into fresh container
kamal app exec -i bash
```

**Common causes:**
- Missing environment variables
- Database connection failed
- Port already in use
- Missing dependencies

### Out of memory

**Symptoms:** Container killed with OOM error.

**Solutions:**
1. Increase memory limit:
   ```yaml
   servers:
     web:
       options:
         memory: 4g
   ```

2. Check for memory leaks in app

3. Monitor with:
   ```bash
   kamal app exec 'cat /sys/fs/cgroup/memory/memory.usage_in_bytes'
   ```

### Wrong port

**Symptoms:** Proxy can't connect to container.

**Solutions:**
Kamal 2.x defaults to port 80. Update your Dockerfile:
```dockerfile
EXPOSE 80
CMD ["bin/rails", "server", "-b", "0.0.0.0", "-p", "80"]
```

Or configure in deploy.yml:
```yaml
proxy:
  app_port: 3000  # If your app runs on 3000
```

## Proxy & SSL Issues

### SSL certificate not issued

**Symptoms:** HTTPS not working, certificate errors.

**Requirements for Let's Encrypt:**
1. Domain must point to server IP (check with `dig myapp.com`)
2. Port 443 must be open
3. Only works with single server (no load balancer in front)

**Debug:**
```bash
kamal proxy logs
kamal proxy details
```

**Manual fix:**
```bash
kamal proxy reboot
```

### "Address already in use" on port 80/443

**Symptoms:** Proxy won't start.

**Solutions:**
```bash
# SSH to server
ssh root@your-server

# Find what's using the port
lsof -i :80
netstat -tlnp | grep :80

# Kill the process or stop the service
systemctl stop nginx
systemctl stop apache2

# Reboot proxy
kamal proxy reboot
```

### Proxy not forwarding requests

**Debug:**
```bash
# Check proxy status
kamal proxy details

# View proxy logs
kamal proxy logs -f

# Verify container is running
docker ps | grep your-app
```

**Common causes:**
- Health check failing
- Wrong `app_port` configuration
- Container not on same Docker network

## Registry Issues

### Authentication failed

**Symptoms:** `kamal deploy` fails at push/pull.

**Solutions:**

1. Verify secrets file:
   ```bash
   cat .kamal/secrets | grep KAMAL_REGISTRY
   ```

2. Test manually:
   ```bash
   echo $KAMAL_REGISTRY_PASSWORD | docker login ghcr.io -u username --password-stdin
   ```

3. For GitHub Container Registry, create PAT with:
   - `write:packages`
   - `read:packages`
   - `delete:packages` (optional)

4. For AWS ECR:
   ```bash
   aws ecr get-login-password --region us-east-1 > .kamal/secrets
   # Add: KAMAL_REGISTRY_PASSWORD=<output>
   ```

### Image not found

**Symptoms:** Deploy fails saying image doesn't exist.

**Solutions:**
```bash
# Rebuild image
kamal build push

# Check image exists
docker pull your-registry/your-app:latest
```

## SSH Issues

### Permission denied

**Symptoms:** Can't connect to server.

**Solutions:**
1. Check SSH agent:
   ```bash
   ssh-add -l
   ssh-add ~/.ssh/id_rsa
   ```

2. Test manually:
   ```bash
   ssh root@your-server
   ```

3. Check SSH config:
   ```yaml
   ssh:
     user: root
     keys:
       - ~/.ssh/deploy_key
   ```

4. Use proxy/jump host if needed:
   ```yaml
   ssh:
     proxy: user@bastion.example.com
   ```

### Host key verification failed

**Symptoms:** SSH refuses to connect, asks about fingerprint.

**Solutions:**
```bash
# Add host key
ssh-keyscan your-server >> ~/.ssh/known_hosts

# Or accept manually
ssh root@your-server  # type 'yes'
```

### Connection timeout through firewall

**Solutions:**
```yaml
ssh:
  proxy: user@bastion
  # or
  proxy_command: ssh -W %h:%p bastion
```

## Accessory Issues

### Database not starting

**Debug:**
```bash
kamal accessory logs db
kamal accessory details db
```

**Common issues:**
1. Missing environment variables:
   ```yaml
   accessories:
     db:
       env:
         secret:
           - POSTGRES_PASSWORD  # Must be in .kamal/secrets
   ```

2. Data directory permissions:
   ```bash
   ssh root@server
   ls -la /root/my-app-db/data
   ```

3. Port conflict:
   ```bash
   lsof -i :5432
   ```

### Can't connect to accessory from app

**Solutions:**
1. Use Docker network hostname:
   ```yaml
   env:
     clear:
       DATABASE_HOST: my-app-db  # Service name, not localhost
   ```

2. Verify network:
   ```bash
   kamal app exec 'ping my-app-db'
   ```

3. Check accessory is running:
   ```bash
   kamal accessory details db
   ```

### Data not persisting

**Cause:** Missing or wrong volume configuration.

**Fix:**
```yaml
accessories:
  db:
    directories:
      - data:/var/lib/postgresql/data  # host:container
```

## Performance Issues

### Slow deployments

**Solutions:**
1. Use remote builder for cross-arch:
   ```yaml
   builder:
     remote: ssh://docker@builder-host
   ```

2. Enable caching:
   ```yaml
   builder:
     cache:
       type: registry
       image: myuser/my-app-cache
   ```

3. Optimize Dockerfile layer order

### High memory on servers

**Debug:**
```bash
kamal app exec 'free -m'
docker stats
```

**Solutions:**
1. Set container limits:
   ```yaml
   servers:
     web:
       options:
         memory: 2g
   ```

2. Increase `retain_containers` cleanup:
   ```yaml
   retain_containers: 2
   ```

3. Manual prune:
   ```bash
   kamal prune all
   ```

## Debugging Commands

### View everything
```bash
kamal details           # All containers
kamal config            # Full config (including secrets!)
```

### Application
```bash
kamal app logs          # View logs
kamal app logs -f       # Follow logs
kamal app exec -i bash  # Shell into container
kamal app containers    # List containers
kamal app details       # Container details
```

### Proxy
```bash
kamal proxy logs
kamal proxy details
kamal proxy reboot
```

### Accessories
```bash
kamal accessory logs db
kamal accessory exec db -i bash
kamal accessory details db
kamal accessory reboot db
```

### Build
```bash
kamal build            # Build image
kamal build push       # Build and push
kamal build details    # Build info
```

### Server
```bash
kamal server bootstrap # Install Docker
kamal server exec 'docker ps'  # Run command on all servers
```

### Audit
```bash
kamal audit            # Show deployment history
```

### Complete removal
```bash
kamal remove           # Remove everything
kamal remove -y        # Skip confirmation
```
