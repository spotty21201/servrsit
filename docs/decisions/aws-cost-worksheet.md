# ServrSit — AWS Cost Worksheet (T-015)

| Field | Value |
|---|---|
| Date prepared | 2026-11-17 |
| Owner | Coder |
| Basis | **Public list prices only.** No AWS account exists (ADR-010). Nothing was provisioned or measured. |
| Region priced | ap-southeast-1 (Singapore) |
| Currency | USD, on-demand, no reserved instances, no savings plans, no free-tier credit assumed |
| Month length | 730 hours |
| Requirement links | Technical Spec §19; PRD §11.2, §13.3 |

These are list prices, not measured actuals. Every figure below is a unit price from AWS's public Price List API multiplied by the stated assumption. Treat the totals as a decision input for whether to open an account. They are not a forecast of a bill.

## 1. Sources

Unit prices come from `https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/<Offer>/current/ap-southeast-1/index.json`, the machine-readable source behind the AWS pricing pages. No web search tool was available in this session, so the pricing web pages were not read.

| Offer | Price file publication date |
|---|---|
| AmazonEC2 | 2026-11-14 |
| AmazonVPC (public IPv4) | 2026-11-05 |
| AWSDataTransfer | 2026-11-16 |
| AmazonS3 | 2026-11-16 |
| awskms | 2026-11-08 |
| AWSSecretsManager | 2026-11-11 |
| AmazonCognito | 2026-10-20 |
| AmazonCloudWatch | 2026-11-16 |
| AmazonBedrockFoundationModels | 2026-11-09 |
| AmazonBedrock | 2026-11-11 |

## 2. Unit prices used

| Component | Unit price | Price file usage type |
|---|---|---|
| EC2 t3.small, Linux, shared tenancy | $0.0264 / hr | Compute Instance |
| EC2 t3.medium, Linux, shared tenancy | $0.0528 / hr | Compute Instance |
| EBS gp3 storage | $0.096 / GB-month | `APS1-EBS:VolumeUsage.gp3` |
| EBS gp3 extra IOPS (beyond baseline) | $0.006 / IOPS-month | `APS1-EBS:VolumeP-IOPS.gp3` |
| Public IPv4, in use | $0.005 / hr | `APS1-PublicIPv4:InUseAddress` |
| S3 Standard storage (first 50 TB) | $0.025 / GB-month | `APS1-TimedStorage-ByteHrs` |
| S3 PUT/COPY/POST/LIST | $0.005 / 1,000 | `APS1-Requests-Tier1` |
| S3 GET and other | $0.004 / 10,000 | `APS1-Requests-Tier2` |
| KMS customer managed key | $1.00 / key-month | `ap-southeast-1-KMS-Keys` |
| KMS requests (symmetric) | $0.03 / 10,000 (first 20,000/month free, global) | `KMS-Requests` |
| KMS RSA 2048 asymmetric requests | $0.03 / 10,000 | `KMS-Requests-Asymmetric-RSA_2048` |
| Secrets Manager secret | $0.40 / secret-month | `AWSSecretsManager-Secret` |
| Secrets Manager API calls | $0.05 / 10,000 | `AWSSecretsManagerAPIRequest` |
| Cognito Essentials MAU | $0.015 / MAU | `APS1-CognitoEssentialsMAU` |
| Cognito Lite MAU | $0.0055 / MAU | `APS1-CognitoLiteMAU` |
| Cognito free tier | first 10,000 MAU at $0 | `Global-CognitoFreeTierMAU` |
| CloudWatch custom log ingestion | $0.70 / GB | `APS1-DataProcessing-Bytes` |
| CloudWatch log storage | $0.03 / GB-month | `APS1-TimedStorage-ByteHrs` |
| CloudWatch standard alarm | $0.10 / alarm-month | `APS1-CW:AlarmMonitorUsage` |
| CloudWatch custom metric | $0.30 / metric-month (first 10,000) | `APS1-CW:MetricMonitorUsage` |
| Internet data transfer out (first 10 TB) | $0.12 / GB | `APS1-DataTransfer-Out-Bytes` |
| Data transfer in from internet | $0.00 / GB | EC2 offer |

## 3. Monthly estimate: one dedicated installation

### 3.1 Assumptions

| Component | Assumption |
|---|---|
| EBS | 20 GB gp3 root + 50 GB gp3 data volume, baseline 3,000 IOPS / 125 MB/s (included, no extra IOPS bought) |
| Public IPv4 | One address, in use all month |
| S3 | 10 GB stored, 20,000 PUT/LIST, 100,000 GET per month (backups, intent objects, exports) |
| KMS | 2 customer managed keys (one general, one asymmetric signing key). Request volume assumed inside the 20,000 free monthly requests |
| Secrets Manager | 2 secrets, API calls negligible |
| Cognito | 1 user pool, 1 MAU. Falls inside the 10,000 MAU free tier in the price file |
| CloudWatch | 1 GB log ingestion, 1 GB stored, 2 alarms, no custom metrics (EC2 basic metrics have no charge) |
| Data transfer out | 1 GB per month to the internet |
| Inference | 100,000 input + 20,000 output tokens per month |

### 3.2 Line items

| Component | t3.small | t3.medium | Calculation |
|---|---:|---:|---|
| EC2 compute | 19.27 | 38.54 | rate x 730 h |
| EBS gp3, 70 GB | 6.72 | 6.72 | 70 x 0.096 |
| Public IPv4 | 3.65 | 3.65 | 0.005 x 730 |
| S3 storage + requests | 0.39 | 0.39 | 10 x 0.025 + 20 x 0.005 + 100,000 x 0.0000004 |
| KMS, 2 keys | 2.00 | 2.00 | 2 x 1.00 |
| Secrets Manager, 2 secrets | 0.80 | 0.80 | 2 x 0.40 |
| Cognito, 1 MAU | 0.00 | 0.00 | inside 10,000 MAU free tier |
| CloudWatch | 0.93 | 0.93 | 0.70 ingest + 0.03 storage + 0.20 alarms |
| Data transfer out, 1 GB | 0.12 | 0.12 | 1 x 0.12 |
| **Idle total (no inference)** | **33.88** | **53.15** | |

### 3.3 Bedrock inference (100K input + 20K output tokens per month)

| Model | Input $/1M | Output $/1M | Monthly cost | Pricing type in price file |
|---|---:|---:|---:|---|
| Claude 3 Haiku | 0.25 | 1.25 | $0.05 | Regional on-demand SKU |
| Claude Haiku 4.5 | 1.00 | 5.00 | $0.20 | "Global" cross-region SKU |
| Claude Haiku 5.5 | 0.10 | 0.50 | $0.02 | "Global" standard SKU |
| Amazon Nova Lite | 0.081 / 1M | 0.324 / 1M | $0.01 | Regional on-demand SKU |

Light inference costs between $0.01 and $0.20 a month. It does not affect the verdict.

### 3.4 Totals

| Scenario | t3.small | t3.medium |
|---|---:|---:|
| Idle (no inference) | **$33.88** | **$53.15** |
| Active (Claude Haiku 4.5, the dearest option above) | $34.08 | $53.35 |
| Active (Claude 3 Haiku) | $33.93 | $53.20 |

## 4. Bedrock availability in ap-southeast-1

Price entries for ap-southeast-1 exist for Claude 3 Haiku, 3.5 and 3.7 Sonnet, Sonnet 4/4.5/4.6/5/5.5, Haiku 4.5/5.5, several Opus models, Amazon Nova Micro/Lite/Pro/2.0, and others.

**This does not prove a model can be invoked in Singapore.** A price entry only says a price exists. Two specific cautions:

1. **Most Claude entries are "Global" cross-region SKUs.** Haiku 4.5 and Haiku 5.5 are priced as global inference. That routes requests to other regions. Technical Spec §15 requires cross-region processing to be disabled unless reviewed and disclosed. Choosing a global-profile model is a data-handling decision for Spotty and the Orchestrator. It is not only a cost choice.
2. **Only Claude 3 Haiku and the Nova Micro/Lite models have plain regional SKUs.** Claude 3 Haiku is an older model. Its deprecation or end-of-life status was not checked and must be before it is selected.

Confirming real availability needs an AWS account (`aws bedrock list-foundation-models` and the inference-profile list for the region) or the Bedrock console model-availability page. This is an open item and blocks the Bedrock model decision in Technical Spec §22.

## 5. Verdict against the PRD envelope

PRD §13.3 sets the direct infrastructure/AI envelope at **US$7.25 per workspace per month** (25% of the illustrative US$29 price).

**The dedicated-per-owner architecture does not fit the envelope.**

| Measure | Amount | Multiple of $7.25 |
|---|---:|---:|
| EC2 compute alone, t3.small | $19.27 | 2.7x |
| Idle total, t3.small | $33.88 | 4.7x |
| Idle total, t3.medium | $53.15 | 7.3x |
| Lean floor, t3.small (see below) | $27.31 | 3.8x |

The compute line alone exceeds the whole envelope. No component trimming closes that gap.

**Realistic floor for this architecture: about $27 per month**, at the smallest viable list-price configuration: t3.small, 20 GB root volume only, one public IPv4, one KMS key, one secret, 10 GB S3, 1 GB logs, 1 GB egress. That is $27.31 on list prices, about 94% of the $29 price and nearly four times the envelope.

**Sizing caveat:** Technical Spec §19 states a benchmark hypothesis of about 2 vCPU and 4 GiB RAM. A t3.small has 2 GiB. The 4 GiB class is t3.medium, so the realistic planning figure is the t3.medium column, **$53.15 idle**, until a disposable installation measures actual memory use. At that size infrastructure cost is about 1.8x the US$29 price.

**What this means by stage:**

- **Stage A (founder alpha):** The cost is one person's infrastructure, roughly $34 to $53 a month. The envelope does not apply to the founder's own use. Spotty decides whether that is acceptable.
- **Stage B (invited pilot, 5 to 10 owners):** Each owner gets a separate installation, so cost scales linearly: about $170 to $530 a month for 5 to 10 owners at list prices. Free or cost-shared pilots only.
- **Stage C (paid):** Dedicated installations cannot be sold at US$29. PRD §13.3 requires changing the price, architecture, or customer segment. Technical Spec §1.1 and §19 say a shared-service architecture needs a separate reviewed design, which the spec currently forbids for A and B.

The cost levers that exist inside the dedicated model are not enough on their own: reserved or savings-plan pricing (excluded from this worksheet by instruction), Arm instances (the spec starts with x86-64), and dropping the data volume.

## 6. Not included

These are real costs that this worksheet does not price:

| Item | Why excluded |
|---|---|
| Tailscale subscription | Not an AWS price. Terms must be checked under T-016 |
| Domain registration, Route 53 | Needs founder authorization; not priced |
| TLS certificate path | Caddy with ACME has no AWS charge; ACM plus a load balancer would add cost |
| SES email (Stage B) | Out of scope for the requested components |
| EBS snapshots, WAL archive growth beyond 10 GB | Backup volume is unmeasured |
| t3 CPU credit surcharge | t3 instances default to unlimited mode, which bills for sustained CPU above baseline. Not modeled |
| Recurring support labor, payment fees | PRD §13.3 includes these in the full economic gate. Not AWS costs |
| Taxes and free-tier credits | Not modeled |
| Larger egress | SSH and API traffic to 2 to 20 servers is unmeasured. 1 GB is the stated assumption |

## 7. Contradictions and open items

1. **Technical Spec §1.1 / §19 versus PRD §13.3.** The spec chooses a dedicated installation per owner. The PRD envelope is not achievable with it. The spec already warns of this. This worksheet confirms it with numbers. ADR-004 requires T-015 to quantify this, and it now does.
2. **Technical Spec §19 sizing versus the cheapest instance.** The 4 GiB hypothesis maps to t3.medium, not t3.small.
3. **Technical Spec §15 versus Claude 4.5 and 5.5 pricing.** Those models are priced as global cross-region. This conflicts with the default of no cross-region routing.
4. **Open:** actual Bedrock invocation availability in ap-southeast-1 (needs an account).
5. **Open:** Claude 3 Haiku lifecycle status.
6. **Open:** Cognito free tier applicability to the tier chosen for managed login and TOTP MFA. The price file shows a 10,000 MAU free tier. The tier-to-feature mapping was not verified.

## 8. Authorization status

No resources were purchased and no account was created. Per the technology steering file, Spotty reviews this worksheet and authorizes region and spend before any AWS resource is created. Decision IDs D-AWS-01 and ADR-003 remain **[PENDING FOUNDER]**.
