# ServrSit infrastructure (AWS CDK) — SYNTH ONLY

This directory defines one dedicated ServrSit installation for one owner on AWS (Technical Spec §4, ADR-004). **It has never been deployed and must not be deployed** until the founder approves the account, region and budget (ADR-014, D-AWS-01). There is no deploy script: `pnpm deploy` prints a refusal and exits 1.

What the founder must do first is in [`docs/team/aws-runbook.md`](../docs/team/aws-runbook.md).

## Synthesize offline

```sh
cd infra
pnpm install
env AWS_SHARED_CREDENTIALS_FILE=/dev/null AWS_CONFIG_FILE=/dev/null AWS_EC2_METADATA_DISABLED=true \
    CDK_DISABLE_VERSION_CHECK=1 CDK_DISABLE_CLI_TELEMETRY=true \
    pnpm synth                    # cdk synth --no-notices --quiet
ls cdk.out/                       # ServrSit-founder.template.json is the reviewable CloudFormation
pnpm test                         # 9 offline checks of the template
```

The stack is environment-agnostic (no account, no region), and nothing is looked up at synth time. The Ubuntu AMI is an SSM parameter that CloudFormation resolves at deploy time. Synthesis therefore needs no credentials. Verified 2026-11-17: under `strace -e trace=connect`, `cdk synth` made 0 IPv4/IPv6 connections (only the local tsx pipe and the local name-service cache).

Context (in `cdk.json`, override with `-c`): `servrsit:installationId` (default `founder`), `servrsit:instanceType` (default `t3.medium`), `servrsit:dataVolumeGiB` (default `50`).

## What the stack creates

| Spec §4 item | Resource | Controls |
|---|---|---|
| EC2 + encrypted EBS | `Controller` instance, 20 GiB gp3 root, 50 GiB gp3 `DataVolume` | Ubuntu 24.04 (Canonical SSM parameter), **IMDSv2 required**, **no SSH key pair**, volumes encrypted with the installation key, data volume retained |
| Network | 1 VPC, 1 public subnet, internet gateway | **No NAT gateway, no load balancer.** Ingress **443 and 80 only, no 22.** Egress limited to 443, 80, 22 (to managed servers), UDP 41641 and 3478 (Tailscale). |
| Operator access | `AmazonSSMManagedInstanceCore` on the role | Session Manager instead of public SSH |
| Secrets Manager + KMS | `DataKey` (rotation on) | The role may read only `servrsit/<installation>/*`; no `ListSecrets`; **no secret is created here** |
| Manifest signing | `ManifestSigningKey` RSA_3072, SIGN_VERIFY | Role may `kms:Sign` and `kms:GetPublicKey` on this key only |
| S3 | `Records` bucket | Block all public access, KMS, TLS-only policy, versioned, lifecycle: exports 7 d, `operations/` 90 d, backups 35 d, noncurrent versions 30 d |
| Cognito | `Owners` pool + `Web` client | No self sign-up, **TOTP MFA required**, authorization-code flow, no client secret, no password auth flows |
| CloudWatch | `/servrsit/<installation>/app` | 30-day retention |
| Cost | `MonthlyBudget` (AWS Budgets) | Email at 80% actual and 100% forecast. **Alerts do not stop spending.** |
| Deployment guard | CloudFormation rule `RequireFounderApproval` | Deploy fails unless parameter `FounderSpendApproval` equals `I-approve-the-reviewed-ServrSit-budget` |

## Deliberately not in the stack yet

- **Application install:** no user data, no packages, no Caddy or TLS certificate, no systemd units.
- **Network and login wiring:** no Tailscale enrollment (D-TAILSCALE-01), no DNS or Route 53 (D-DOMAIN-01), no Cognito hosted-UI domain.
- **Data:** no secrets with values. No PostgreSQL or pgBackRest: the local build uses SQLite (ADR-015).
- **AI:** no Bedrock permissions, because no model is selected (ADR-013 uses a third-party endpoint).
- **Operations:** no CloudTrail, GuardDuty or SSM session logging. These are account-level choices in the runbook.
- **Security group default:** `restrictDefaultSecurityGroup` is off, because turning it on adds a custom-resource Lambda. The default group is unused.

## Retained on deletion (costs continue until removed by hand)

`DataKey`, `ManifestSigningKey`, the `Records` bucket, `DataVolume`, the `Owners` user pool (deletion protection on) and the log group.
