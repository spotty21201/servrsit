/**
 * Offline checks of the synthesized template (no AWS calls).
 * Technical Spec §4 controls, and the deployment guard.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { APPROVAL_PHRASE, ServrsitInstallationStack, UBUNTU_2404_AMI_PARAMETER } from "../lib/servrsit-stack.js";

function synth() {
  const app = new App();
  const stack = new ServrsitInstallationStack(app, "ServrSit-test", { installationId: "test", instanceType: "t3.medium", dataVolumeGiB: 50 });
  const assembly = app.synth();
  return { template: Template.fromStack(stack), json: Template.fromStack(stack).toJSON() as Record<string, any>, assembly };
}

const { template, json, assembly } = synth();
const resources = (type: string) => Object.values(json["Resources"] as Record<string, { Type: string; Properties: any }>).filter((r) => r.Type === type);

test("synthesizes environment-agnostic, with no context lookups and no Lambda or assets", () => {
  const stack = assembly.getStackByName("ServrSit-test");
  assert.equal(stack.environment.account, "unknown-account");
  assert.equal(stack.environment.region, "unknown-region");
  assert.equal(assembly.manifest.missing, undefined, "no synth-time lookups");
  template.resourceCountIs("AWS::Lambda::Function", 0);
  assert.deepEqual(stack.assets, []);
});

test("deployment guard: a CloudFormation rule refuses unless the founder's approval phrase is passed", () => {
  const params = json["Parameters"] as Record<string, { Default?: string }>;
  assert.equal(params["FounderSpendApproval"]?.Default, "", "no approval by default");
  const rule = (json["Rules"] as Record<string, any>)["RequireFounderApproval"];
  assert.ok(rule, "rule present");
  const text = JSON.stringify(rule);
  assert.ok(text.includes(APPROVAL_PHRASE));
  assert.ok(text.includes('"Ref":"FounderSpendApproval"'));
});

test("network: HTTPS and HTTP in only, never SSH in; explicit egress; one public subnet, no NAT", () => {
  const [sg] = resources("AWS::EC2::SecurityGroup");
  const ingress = (sg!.Properties.SecurityGroupIngress as Array<{ FromPort: number; ToPort: number }>).map((i) => i.FromPort).sort((a, b) => a - b);
  assert.deepEqual(ingress, [80, 443]);
  assert.equal(JSON.stringify(sg!.Properties.SecurityGroupIngress).includes('"FromPort":22'), false);
  assert.ok(Array.isArray(sg!.Properties.SecurityGroupEgress) && sg!.Properties.SecurityGroupEgress.length === 5, "no allow-all egress");
  template.resourceCountIs("AWS::EC2::NatGateway", 0);
  template.resourceCountIs("AWS::ElasticLoadBalancingV2::LoadBalancer", 0);
  template.resourceCountIs("AWS::EC2::Subnet", 1);
});

test("instance: IMDSv2 required, no SSH key pair, Ubuntu 24.04 via SSM parameter, encrypted volumes", () => {
  template.hasResourceProperties("AWS::EC2::LaunchTemplate", {
    LaunchTemplateData: { MetadataOptions: { HttpTokens: "required" } },
  });
  const [inst] = resources("AWS::EC2::Instance");
  assert.equal("KeyName" in inst!.Properties, false);
  assert.equal(inst!.Properties.InstanceType, "t3.medium");
  assert.equal(inst!.Properties.BlockDeviceMappings[0].Ebs.Encrypted, true);
  assert.ok(JSON.stringify(json["Parameters"]).includes(UBUNTU_2404_AMI_PARAMETER));
  template.hasResourceProperties("AWS::EC2::Volume", { Encrypted: true, VolumeType: "gp3", Size: 50 });
});

test("keys: rotated data key; asymmetric RSA_3072 signing key; both retained", () => {
  template.hasResourceProperties("AWS::KMS::Key", { EnableKeyRotation: true });
  template.hasResourceProperties("AWS::KMS::Key", { KeySpec: "RSA_3072", KeyUsage: "SIGN_VERIFY" });
  for (const k of Object.values(json["Resources"] as Record<string, { Type: string; DeletionPolicy?: string }>).filter((r) => r.Type === "AWS::KMS::Key")) {
    assert.equal(k.DeletionPolicy, "Retain");
  }
});

test("records bucket: private, KMS-encrypted, TLS-only, versioned, explicit lifecycle", () => {
  template.hasResourceProperties("AWS::S3::Bucket", {
    PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true },
    BucketEncryption: { ServerSideEncryptionConfiguration: [Match.objectLike({ ServerSideEncryptionByDefault: { SSEAlgorithm: "aws:kms", KMSMasterKeyID: Match.anyValue() } })] },
    VersioningConfiguration: { Status: "Enabled" },
  });
  const [bucket] = resources("AWS::S3::Bucket");
  const rules = (bucket!.Properties.LifecycleConfiguration.Rules as Array<{ Id: string }>).map((r) => r.Id).sort();
  assert.deepEqual(rules, ["backups", "exports", "noncurrent-versions", "operation-records"]);
  const [policy] = resources("AWS::S3::BucketPolicy");
  assert.ok(JSON.stringify(policy!.Properties).includes('"aws:SecureTransport":"false"'), "TLS enforced");
});

test("controller role: least privilege, secrets scoped to this installation, no ListSecrets, no wildcard admin", () => {
  const [policy] = resources("AWS::IAM::Policy");
  const text = JSON.stringify(policy!.Properties.PolicyDocument);
  assert.equal(text.includes("secretsmanager:ListSecrets"), false);
  assert.ok(text.includes(":secret:servrsit/test/*"));
  assert.equal(/"Action":"\*"/.test(text), false);
  assert.equal(text.includes("bedrock:"), false, "no model is selected yet (ADR-013)");
  const statements = policy!.Properties.PolicyDocument.Statement as Array<{ Action: string | string[]; Resource: unknown }>;
  for (const s of statements) {
    const actions = ([] as string[]).concat(s.Action);
    if (actions.some((a) => a.startsWith("secretsmanager:"))) assert.notEqual(s.Resource, "*");
  }
});

test("owner login: no self sign-up, TOTP MFA required, authorization-code client without a secret", () => {
  template.hasResourceProperties("AWS::Cognito::UserPool", {
    MfaConfiguration: "ON",
    EnabledMfas: ["SOFTWARE_TOKEN_MFA"],
    AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
  });
  template.hasResourceProperties("AWS::Cognito::UserPoolClient", {
    GenerateSecret: false,
    AllowedOAuthFlows: ["code"],
    PreventUserExistenceErrors: "ENABLED",
  });
});

test("cost guard: a monthly budget with actual and forecast email alerts", () => {
  template.hasResourceProperties("AWS::Budgets::Budget", {
    Budget: Match.objectLike({ BudgetType: "COST", TimeUnit: "MONTHLY" }),
    NotificationsWithSubscribers: [
      Match.objectLike({ Notification: Match.objectLike({ NotificationType: "ACTUAL", Threshold: 80 }) }),
      Match.objectLike({ Notification: Match.objectLike({ NotificationType: "FORECASTED", Threshold: 100 }) }),
    ],
  });
});
