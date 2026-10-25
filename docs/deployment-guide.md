# MAE Autonomous Customer Data Operations Platform
## Deployment Guide

---

## Prerequisites

### Required BTP Services
| Service | Plan | Purpose |
|---------|------|---------|
| SAP HANA Cloud | hdi-shared | Database persistence |
| XSUAA | application | Authentication & Authorization |
| Destination Service | lite | Routing to S/4HANA APIs |
| Job Scheduler | lite | Scheduled batch job execution |
| HTML5 Application Repository | app-host + app-runtime | SAPUI5 app hosting |
| SAP AI Core | extended | Generative AI Hub for Copilot |

### Required Tools
```bash
npm install -g mbt @sap/cds-dk @sap/cf-tools
cf install-plugin multiapps
```

### Required CF CLI Version
```bash
cf --version  # Must be v8.x or later
```

---

## Step 1: Clone Repository
```bash
git clone https://github.com/duci/mae-cdop.git
cd mae-cdop
```

## Step 2: Install Dependencies
```bash
npm --prefix assets/mae-cap-backend ci
```

## Step 3: Generate Seed Data
```bash
cd assets/mae-cap-backend
node scripts/seed-data.js --scenario=demo
# For full 100K dataset:
node scripts/seed-data.js --scenario=performance --count=100000
```

## Step 4: Configure AI Core
Set the AI deployment ID in MTA environment variables:
```yaml
# In mta.yaml, under mae-cap-backend properties:
AI_DEPLOYMENT_ID: your-gpt4-deployment-id
AI_RESOURCE_GROUP: default
```

## Step 5: Build MTA Archive
```bash
mbt build -p cf
# Output: mta_archives/mae-cdop_1.0.0.mtar
```

## Step 6: Deploy to BTP Cloud Foundry
```bash
# Login to CF
cf login -a https://api.cf.eu10.hana.ondemand.com -u YOUR_EMAIL

# Deploy
cf deploy mta_archives/mae-cdop_1.0.0.mtar -f
```

Deployment time: approximately 8-12 minutes.

## Step 7: Assign Role Collections
In SAP BTP Cockpit → Security → Role Collections:
- Assign **DUCI_MAE_Operators** to operations team members
- Assign **DUCI_MAE_Analysts** to business analysts and executives
- Assign **DUCI_MAE_Admins** to IT administrators

## Step 8: Verify Deployment
```bash
# Check all apps are running
cf apps | grep mae

# Expected output:
# mae-cap-backend      started  1/1  512M  1G
# mae-ui-approuter     started  1/1  128M  256M

# Health check
curl https://mae-cap-backend.cfapps.eu10.hana.ondemand.com/health
```

---

## Environment Variables Reference

| Variable | Default | Description |
|----------|---------|-------------|
| NODE_ENV | production | Runtime environment |
| LOG_LEVEL | info | Winston log level |
| MAX_RETRY_COUNT | 3 | Max retries per failed record |
| RETRY_BASE_DELAY_MS | 1000 | Exponential backoff base (ms) |
| BATCH_CHUNK_SIZE | 500 | Records per HANA processing chunk |
| SIMULATION_MODE | false | Global simulation mode override |
| AI_DEPLOYMENT_ID | gpt-4o | AI Core deployment identifier |
| AI_RESOURCE_GROUP | default | AI Core resource group |

---

## Troubleshooting

### HANA Deployment Fails
```bash
cf logs mae-hana-deployer --recent
# Check for missing HDI container binding or schema permission issues
```

### AI Core Connection Fails
- Verify service binding: `cf env mae-cap-backend | grep AICORE`
- Confirm deployment ID exists in AI Core resource group
- Copilot gracefully falls back to structured responses if AI Hub is unavailable

### Job Scheduler Not Triggering
```bash
cf env mae-cap-backend | grep JOB_SCHEDULER
# Verify jobscheduler service instance is bound
```

### Performance Issues with 100K Records
- Confirm HANA Cloud instance has ≥ 32GB memory
- Verify BATCH_CHUNK_SIZE is ≤ 1000 for optimal HANA JSON_TABLE performance
- Enable SIMULATION_MODE=true for benchmark testing without HANA writes
