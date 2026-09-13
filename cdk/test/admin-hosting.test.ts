import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import * as amplify from "aws-cdk-lib/aws-amplify";
import * as iam from "aws-cdk-lib/aws-iam";
import { provisionAdminSource } from "../lib/admin-source";

function synthAdmin(opts: {
  repository?: string;
  githubToken?: string;
} = {}) {
  const app = new cdk.App();
  const stack = new cdk.Stack(app, "AdminTest", {
    env: { account: "123456789012", region: "us-west-2" },
  });
  const role = new iam.Role(stack, "AmplifyServiceRole", {
    assumedBy: new iam.ServicePrincipal("amplify.amazonaws.com"),
  });
  const source = provisionAdminSource(stack, {
    namePrefix: "context101",
    serviceRole: role,
    repository: opts.repository,
    githubToken: opts.githubToken,
  });
  new amplify.CfnApp(stack, "WebApp", {
    name: "context101-web",
    description: "Context101 knowledge admin UI",
    repository: source.repositoryUrl,
    ...(source.accessToken ? { accessToken: source.accessToken } : {}),
    iamServiceRole: role.roleArn,
    platform: "WEB_COMPUTE",
  });
  return { template: Template.fromStack(stack), source };
}

test("Amplify app is created without githubToken", () => {
  const { template, source } = synthAdmin();
  assert.equal(source.usingCodeCommit, true);
  assert.equal(source.accessToken, undefined);
  template.resourceCountIs("AWS::Amplify::App", 1);
  template.hasResourceProperties("AWS::Amplify::App", {
    Platform: "WEB_COMPUTE",
    Name: "context101-web",
  });
});

test("CfnApp has no accessToken on the CodeCommit path", () => {
  const { template } = synthAdmin();
  const apps = template.findResources("AWS::Amplify::App");
  const props = Object.values(apps)[0]?.Properties ?? {};
  assert.equal(Object.prototype.hasOwnProperty.call(props, "AccessToken"), false);
  template.hasResourceProperties(
    "AWS::Amplify::App",
    Match.objectLike({
      AccessToken: Match.absent(),
    })
  );
});

test("CodeCommit repo exists when Amplify has no githubToken", () => {
  const { template, source } = synthAdmin();
  assert.ok(source.repo);
  template.resourceCountIs("AWS::CodeCommit::Repository", 1);
  template.hasResourceProperties("AWS::CodeCommit::Repository", {
    RepositoryName: "context101-admin",
  });
});

test("optional GitHub override keeps accessToken and skips CodeCommit", () => {
  const { template, source } = synthAdmin({
    repository: "https://github.com/acme/context101",
    githubToken: "ghp_testtoken_xx",
  });
  assert.equal(source.usingCodeCommit, false);
  assert.equal(source.accessToken, "ghp_testtoken_xx");
  template.resourceCountIs("AWS::CodeCommit::Repository", 0);
  template.hasResourceProperties("AWS::Amplify::App", {
    Repository: "https://github.com/acme/context101",
    AccessToken: "ghp_testtoken_xx",
  });
});

test("stack always provisions admin (no githubToken gate)", () => {
  const src = readFileSync(
    path.resolve(__dirname, "../lib/context101-stack.ts"),
    "utf8"
  );
  assert.match(src, /provisionAdminSource/);
  assert.match(src, /WebAppDefaultDomain/);
  assert.equal(src.includes("if (githubToken && amplifyRepository)"), false);
  assert.equal(src.includes("Omit both to skip Amplify"), false);
});
