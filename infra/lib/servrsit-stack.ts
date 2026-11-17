/**
 * One dedicated ServrSit installation for one owner (Technical Spec §4, ADR-004).
 *
 *   EC2 (Ubuntu 24.04, IMDSv2 only, no SSH key, SSM for operator access)
 *   encrypted EBS root + data volume (customer-managed KMS key)
 *   security group: 443 and 80 in only (no 22); explicit egress list
 *   private S3 bucket: KMS, versioned, TLS-only, explicit lifecycle
 *   KMS asymmetric key for manifest signing (RSA_3072, SIGN_VERIFY)
 *   Secrets Manager: no secrets created here; the role may read only
 *     servrsit/<installation>/* (no ListSecrets)
 *   Cognito user pool: no self sign-up, TOTP MFA required
 *   CloudWatch log group (30 days), monthly AWS Budget with email alerts
 *
 * Guard: a CloudFormation rule fails the deployment unless the founder passes
 * the exact approval phrase as a parameter. Nothing here is deployed.
 *
 * Not included on purpose: NAT gateway, load balancer, Lambda functions,
 * Bedrock permissions (no model selected; ADR-013), Route 53 (D-DOMAIN-01).
 */

import {
  Aws,
  CfnOutput,
  CfnParameter,
  CfnRule,
  Duration,
  Fn,
  RemovalPolicy,
  Size,
  Stack,
  type StackProps,
} from "aws-cdk-lib";
import * as budgets from "aws-cdk-lib/aws-budgets";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as kms from "aws-cdk-lib/aws-kms";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";

export const APPROVAL_PHRASE = "I-approve-the-reviewed-ServrSit-budget";
export const UBUNTU_2404_AMI_PARAMETER = "/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id";

export interface ServrsitInstallationStackProps extends StackProps {
  readonly installationId: string;
  readonly instanceType: string;
  readonly dataVolumeGiB: number;
}

export class ServrsitInstallationStack extends Stack {
  constructor(scope: Construct, id: string, props: ServrsitInstallationStackProps) {
    super(scope, id, props);
    const install = props.installationId;

    // ---- deployment guard and budget parameters ----------------------------
    const approval = new CfnParameter(this, "FounderSpendApproval", {
      type: "String",
      default: "",
      description: `Deployment is refused unless this equals "${APPROVAL_PHRASE}". Set only after the founder approved the budget (docs/team/aws-runbook.md).`,
    });
    new CfnRule(this, "RequireFounderApproval", {
      assertions: [
        {
          assert: Fn.conditionEquals(approval.valueAsString, APPROVAL_PHRASE),
          assertDescription: "Refused: the founder has not approved the ServrSit budget for this deployment.",
        },
      ],
    });
    const monthlyBudget = new CfnParameter(this, "MonthlyBudgetUsd", {
      type: "Number",
      default: 60,
      minValue: 1,
      maxValue: 500,
      description: "Monthly cost budget in USD. Alerts at 80% actual and 100% forecast. Alerts do not stop spending.",
    });
    const alertEmail = new CfnParameter(this, "BudgetAlertEmail", {
      type: "String",
      allowedPattern: "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$",
      constraintDescription: "must be an email address",
      description: "Email address for budget alerts.",
    });
    const webDomain = new CfnParameter(this, "WebDomain", {
      type: "String",
      default: "servrsit.invalid",
      description: "Public HTTPS host name for the web UI (D-DOMAIN-01, undecided). Used for the login callback.",
    });

    // ---- keys ---------------------------------------------------------------
    const dataKey = new kms.Key(this, "DataKey", {
      description: `ServrSit ${install}: EBS and S3 encryption`,
      enableKeyRotation: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const signingKey = new kms.Key(this, "ManifestSigningKey", {
      description: `ServrSit ${install}: signs remote change manifests (Technical Spec §8.2)`,
      keySpec: kms.KeySpec.RSA_3072,
      keyUsage: kms.KeyUsage.SIGN_VERIFY,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // ---- network --------------------------------------------------------------
    const vpc = new ec2.Vpc(this, "Vpc", {
      ipAddresses: ec2.IpAddresses.cidr("10.80.0.0/24"),
      maxAzs: 1,
      natGateways: 0,
      subnetConfiguration: [{ name: "public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 26 }],
      // true would add a custom-resource Lambda; the default group is unused.
      restrictDefaultSecurityGroup: false,
    });

    const sg = new ec2.SecurityGroup(this, "ControllerSg", {
      vpc,
      allowAllOutbound: false,
      description: "ServrSit controller: HTTPS in, HTTP in for ACME/redirect only. No SSH in.",
    });
    sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), "HTTPS (web UI and API)");
    sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), "HTTP: ACME validation and redirect to HTTPS only");
    sg.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), "AWS APIs, package mirrors, Tailscale control");
    sg.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), "Ubuntu package mirrors");
    sg.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(22), "SSH to registered managed servers");
    sg.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.udp(41641), "Tailscale direct connections");
    sg.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.udp(3478), "Tailscale STUN");

    // ---- records ----------------------------------------------------------------
    const records = new s3.Bucket(this, "Records", {
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: dataKey,
      bucketKeyEnabled: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      enforceSSL: true,
      versioned: true,
      removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [
        { id: "exports", prefix: "exports/", expiration: Duration.days(7) },
        { id: "operation-records", prefix: "operations/", expiration: Duration.days(90) },
        { id: "backups", prefix: "backups/", expiration: Duration.days(35) },
        { id: "noncurrent-versions", noncurrentVersionExpiration: Duration.days(30) },
      ],
    });

    const appLogs = new logs.LogGroup(this, "AppLogs", {
      logGroupName: `/servrsit/${install}/app`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // ---- identity of the controller ------------------------------------------
    const role = new iam.Role(this, "ControllerRole", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
      description: `ServrSit ${install} controller: least privilege for this installation only`,
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore")],
    });
    records.grantReadWrite(role);
    dataKey.grantEncryptDecrypt(role);
    signingKey.grant(role, "kms:Sign", "kms:GetPublicKey");
    appLogs.grantWrite(role);
    role.addToPolicy(
      new iam.PolicyStatement({
        sid: "ReadOwnSecretsOnly",
        actions: ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"],
        resources: [`arn:${Aws.PARTITION}:secretsmanager:${Aws.REGION}:${Aws.ACCOUNT_ID}:secret:servrsit/${install}/*`],
      }),
    );

    // ---- the instance -----------------------------------------------------------
    const instance = new ec2.Instance(this, "Controller", {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      instanceType: new ec2.InstanceType(props.instanceType),
      machineImage: ec2.MachineImage.fromSsmParameter(UBUNTU_2404_AMI_PARAMETER, { os: ec2.OperatingSystemType.LINUX }),
      role,
      securityGroup: sg,
      requireImdsv2: true,
      associatePublicIpAddress: true,
      blockDevices: [
        {
          deviceName: "/dev/sda1",
          volume: ec2.BlockDeviceVolume.ebs(20, {
            encrypted: true,
            kmsKey: dataKey,
            volumeType: ec2.EbsDeviceVolumeType.GP3,
            deleteOnTermination: true,
          }),
        },
      ],
    });

    const data = new ec2.Volume(this, "DataVolume", {
      availabilityZone: instance.instanceAvailabilityZone,
      size: Size.gibibytes(props.dataVolumeGiB),
      volumeType: ec2.EbsDeviceVolumeType.GP3,
      encrypted: true,
      encryptionKey: dataKey,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    new ec2.CfnVolumeAttachment(this, "DataVolumeAttachment", {
      instanceId: instance.instanceId,
      volumeId: data.volumeId,
      device: "/dev/sdf",
    });

    // ---- owner login -------------------------------------------------------------
    const owners = new cognito.UserPool(this, "Owners", {
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      mfa: cognito.Mfa.REQUIRED,
      mfaSecondFactor: { sms: false, otp: true },
      passwordPolicy: { minLength: 14, requireDigits: true, requireLowercase: true, requireUppercase: true, requireSymbols: true },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    owners.addClient("Web", {
      generateSecret: false,
      authFlows: { userPassword: false, userSrp: false, custom: false, adminUserPassword: false },
      oAuth: {
        flows: { authorizationCodeGrant: true, implicitCodeGrant: false },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL],
        callbackUrls: [`https://${webDomain.valueAsString}/auth/callback`],
        logoutUrls: [`https://${webDomain.valueAsString}/`],
      },
      preventUserExistenceErrors: true,
    });

    // ---- cost guard ------------------------------------------------------------------
    new budgets.CfnBudget(this, "MonthlyBudget", {
      budget: {
        budgetName: `servrsit-${install}-monthly`,
        budgetType: "COST",
        timeUnit: "MONTHLY",
        budgetLimit: { amount: monthlyBudget.valueAsNumber, unit: "USD" },
      },
      notificationsWithSubscribers: [
        {
          notification: { notificationType: "ACTUAL", comparisonOperator: "GREATER_THAN", threshold: 80, thresholdType: "PERCENTAGE" },
          subscribers: [{ subscriptionType: "EMAIL", address: alertEmail.valueAsString }],
        },
        {
          notification: { notificationType: "FORECASTED", comparisonOperator: "GREATER_THAN", threshold: 100, thresholdType: "PERCENTAGE" },
          subscribers: [{ subscriptionType: "EMAIL", address: alertEmail.valueAsString }],
        },
      ],
    });

    new CfnOutput(this, "InstanceId", { value: instance.instanceId });
    new CfnOutput(this, "RecordsBucket", { value: records.bucketName });
    new CfnOutput(this, "SigningKeyArn", { value: signingKey.keyArn });
    new CfnOutput(this, "UserPoolId", { value: owners.userPoolId });
  }
}
