/**
 * CDK app entry. SYNTH ONLY (ADR-014): no AWS account exists and spend is not
 * approved. `pnpm synth` produces reviewable CloudFormation in cdk.out/.
 * There is no deploy script; see docs/team/aws-runbook.md.
 *
 * The stack is environment-agnostic (no account, no region) so synthesis
 * needs no credentials and makes no AWS calls.
 */

import { App, Tags } from "aws-cdk-lib";
import { ServrsitInstallationStack } from "../lib/servrsit-stack.js";

const app = new App();

const installationId = String(app.node.tryGetContext("servrsit:installationId") ?? "founder");
if (!/^[a-z][a-z0-9-]{1,30}$/.test(installationId)) {
  throw new Error("servrsit:installationId must be lowercase letters, digits and dashes");
}

new ServrsitInstallationStack(app, `ServrSit-${installationId}`, {
  installationId,
  instanceType: String(app.node.tryGetContext("servrsit:instanceType") ?? "t3.medium"),
  dataVolumeGiB: Number(app.node.tryGetContext("servrsit:dataVolumeGiB") ?? 50),
  description: `ServrSit single-owner installation '${installationId}' (Technical Spec §4). Not deployed without founder approval.`,
});

Tags.of(app).add("project", "servrsit");
Tags.of(app).add("installation", installationId);
Tags.of(app).add("managed-by", "cdk");
