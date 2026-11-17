# AWS runbook: what Spotty must do before ServrSit runs on AWS

**Status:** nothing has been created. There is no AWS account (ADR-010), and ADR-014 keeps ServrSit local on Merauke for now. This runbook is ready for when you decide to move. The infrastructure definition is in `infra/` (synthesized offline, never deployed).

Each step says **who** does it. Steps marked *(you)* need you personally: they involve your identity, your money, or a decision only you can make. Agents never create accounts, enter payment details or approve spend.

## 1. Decide (you)

| Decision | Input | Where it is recorded |
|---|---|---|
| **Go or no-go on AWS** | Cost worksheet `docs/decisions/aws-cost-worksheet.md`: list price about **$34/month (t3.small) to $53/month (t3.medium)** per installation in ap-southeast-1, idle, prices as of 2026-11-17. Above the US$7.25 PRD envelope. | D-AWS-01 |
| **Region** | ap-southeast-1 (Singapore) was evaluated. Confirm it, or name another. | ADR-003 |
| **Instance size** | t3.medium is the planning figure (4 GiB). t3.small (2 GiB) may be too small: measure first. | cdk context `servrsit:instanceType` |
| **Monthly budget cap** | A number you are willing to be alerted at, for example $60. | Stack parameter `MonthlyBudgetUsd` |
| **Alert email** | An address you read. | Stack parameter `BudgetAlertEmail` |
| **Domain** | The public HTTPS name for the web UI. Needed for the login callback and TLS. | D-DOMAIN-01, parameter `WebDomain` |
| **AI on AWS** | Keep the current third-party endpoint (ADR-013), or move to Bedrock (Technical Spec §15). Bedrock needs a model choice and model-access approval. | New ADR |

Give the Orchestrator these answers in writing. The Orchestrator records them as an ADR before anything is created.

## 2. Open the account (you)

1. **Create a new AWS account** with a dedicated email address used only for this account (not your everyday inbox), and a long unique password.
2. **Turn on MFA for the root user** straight away. Do not create root access keys.
3. **Enter payment details and a billing contact.** This is the step that makes spend possible.
4. **Set the alternate contacts** (billing, operations, security) so AWS can reach you.
5. **Create an everyday admin identity** (IAM Identity Center user, or an IAM user) with MFA. Use it, not root, for everything after this point.
6. **Sign out of root** and store the root credentials offline.

## 3. Account guardrails (you, or an agent with your admin session, before any deployment)

These protect the account regardless of what ServrSit does. None of them is in the CDK stack, because they are account-wide.

- **An account-level AWS Budget** with an email alert, separate from the stack's own budget, so a mistake outside ServrSit is also caught. Budgets alert; they do not stop spending.
- **Billing alerts** on, and Cost Explorer enabled.
- **S3 Block Public Access** at the account level.
- **EBS encryption by default** in the chosen region.
- **CloudTrail:** one trail for management events, to a private bucket.
- Optional, each with its own cost: GuardDuty, and an SCP that restricts regions (needs AWS Organizations).

## 4. Approve the specific deployment (you)

Read the synthesized template (`infra/cdk.out/ServrSit-<installation>.template.json`) and the `infra/README.md` table. Then tell the Orchestrator, in writing: "Approved: region X, instance size Y, budget $Z, installation id W."

The template itself refuses to deploy without this. A CloudFormation rule fails the deployment unless the parameter `FounderSpendApproval` equals `I-approve-the-reviewed-ServrSit-budget`. That phrase is passed only after your written approval.

## 5. Deploy (Orchestrator and Coder, only after steps 1–4)

1. **Prepare the account for CDK.** `cdk bootstrap aws://<account>/<region>` creates CDK's bootstrap stack: an S3 bucket, an ECR repository, IAM roles and an SSM parameter. It has a small cost of its own.
2. **Deploy:** `cdk deploy` with the parameters `FounderSpendApproval`, `MonthlyBudgetUsd`, `BudgetAlertEmail` and `WebDomain`. `requireApproval: broadening` makes the CLI ask before any security-sensitive change.
3. **Install the application.** Not built yet: no user data, packages, TLS (Caddy and ACME), systemd units or Tailscale enrollment exist (see `infra/README.md`).
4. **Verify:** measure actual cost against the worksheet in the first days, check the budget alert email arrives, and test restore before trusting backups (Technical Spec §17.3).

## 6. Before external pilots (Stage B)

Repeat per invited owner with a separate installation id. Test the cross-installation IAM denials with real roles (Technical Spec §4.4). Replace the local intent store with S3 conditional writes (ADR-015). Replace SQLite with PostgreSQL and pgBackRest.

## 7. Undo and leftover costs

Deleting the stack does **not** delete everything. These are retained on purpose, and keep costing money until removed by hand:

- **The two KMS keys.** About $1/month each in the worksheet. Deletion has a mandatory waiting period.
- **The records bucket and its versions.** S3 storage charges continue.
- **The data volume.** EBS charges continue.
- **The Cognito user pool** (deletion protection on) and the log group.

To close the account entirely, remove these first, then follow AWS's account-closure process.

## To recheck at deployment time (not verified offline)

- **AWS::Budgets::Budget in the chosen region:** I did not verify that it deploys from ap-southeast-1.
- **The Canonical SSM parameter:** check that `/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id` exists in the region.
- **Instance and storage availability:** check that t3.medium and gp3 are available in the chosen Availability Zone.
- **Prices:** current list prices, against the 2026-11-17 worksheet.
